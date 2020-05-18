"""
Copyright (c) 2012-2013 RockStor, Inc. <http://rockstor.com>
This file is part of RockStor.

RockStor is free software; you can redistribute it and/or modify
it under the terms of the GNU General Public License as published
by the Free Software Foundation; either version 2 of the License,
or (at your option) any later version.

RockStor is distributed in the hope that it will be useful, but
WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program. If not, see <http://www.gnu.org/licenses/>.
"""

import re
from shutil import move, copy
from tempfile import mkstemp
from services import systemctl
from system.osi import run_command
import os
from django.conf import settings


SSHD_CONFIG = "/etc/ssh/sshd_config"
MKDIR = "/usr/bin/mkdir"
MOUNT = "/usr/bin/mount"
USERMOD = "/usr/sbin/usermod"
SFTP_REGEX = "Subsystem\s+sftp"
SFTP_STR = "Subsystem\tsftp\tinternal-sftp"


def update_sftp_config(input_map):
    """
    input map is a dictionary of user,directory pairs
    """
    fo, npath = mkstemp()
    userstr = "AllowUsers root %s" % " ".join(input_map.keys())
    with open(SSHD_CONFIG) as sfo, open(npath, "w") as tfo:
        for line in sfo.readlines():
            if re.match(settings.SSHD_HEADER, line) is None:
                tfo.write(line)
            else:
                break
        tfo.write("{}\n".format(settings.SSHD_HEADER))
        tfo.write("{}\n".format(userstr))
        for user in input_map:
            tfo.write("Match User {}\n".format(user))
            tfo.write("\tChrootDirectory {}\n".format(input_map[user]))

    move(npath, SSHD_CONFIG)
    try:
        systemctl("sshd", "reload")
    except:
        return systemctl("sshd", "restart")


def toggle_sftp_service(switch=True):
    # TODO add Subsystem sftp line below Rockstor header rather than above
    fo, npath = mkstemp()
    written = False
    with open(SSHD_CONFIG) as sfo, open(npath, "w") as tfo:
        for line in sfo.readlines():
            if re.match(SFTP_REGEX, line) is not None:
                if switch and not written:
                    tfo.write("{}\n".format(SFTP_STR))
                    written = True
            elif re.match(settings.SSHD_HEADER, line) is not None:
                if switch and not written:
                    tfo.write("{}\n".format(SFTP_STR))
                    written = True
                tfo.write(line)
            else:
                tfo.write(line)
    move(npath, SSHD_CONFIG)
    try:
        systemctl("sshd", "reload")
    except:
        return systemctl("sshd", "restart")


def sftp_mount_map(mnt_prefix):
    mnt_map = {}
    with open("/proc/mounts") as pfo:
        for line in pfo.readlines():
            if re.search(" " + mnt_prefix, line) is not None:
                fields = line.split()
                sname = fields[1].split("/")[-1]
                editable = fields[3][:2]
                mnt_map[sname] = editable
    return mnt_map


def sftp_mount(share, mnt_prefix, sftp_mnt_prefix, mnt_map, editable="rw"):
    #  don't mount if already mounted
    sftp_mnt_pt = "{}{}/{}".format(sftp_mnt_prefix, share.owner, share.name)
    share_mnt_pt = "{}{}".format(mnt_prefix, share.name)
    if share.name in mnt_map:
        cur_editable = mnt_map[share.name]
        if cur_editable != editable:
            return run_command(
                [
                    MOUNT,
                    "-o",
                    "remount,{},bind".format(editable),
                    share_mnt_pt,
                    sftp_mnt_pt,
                ]
            )
    else:
        run_command([MKDIR, "-p", sftp_mnt_pt])
        run_command([MOUNT, "--bind", share_mnt_pt, sftp_mnt_pt])
        if editable == "ro":
            run_command(
                [
                    MOUNT,
                    "-o",
                    "remount,{},bind".format(editable),
                    share_mnt_pt,
                    sftp_mnt_pt,
                ]
            )


def rsync_for_sftp(chroot_loc):
    user = chroot_loc.split("/")[-1]
    run_command([MKDIR, "-p", "{}/bin".format(chroot_loc)], log=True)
    run_command([MKDIR, "-p", "{}/usr/bin".format(chroot_loc)], log=True)
    run_command([MKDIR, "-p", "{}/lib64".format(chroot_loc)], log=True)
    run_command([MKDIR, "-p", "{}/usr/lib64".format(chroot_loc)], log=True)

    copy("/bin/bash", "{}/bin".format(chroot_loc))
    copy("/usr/bin/rsync", "{}/usr/bin".format(chroot_loc))

    libs_d = {
        "rockstor": [
            "/lib64/ld-linux-x86-64.so.2",
            "/lib64/libacl.so.1",
            "/lib64/libattr.so.1",
            "/lib64/libc.so.6",
            "/lib64/libdl.so.2",
            "/lib64/libpopt.so.0",
            "/lib64/libtinfo.so.5",
        ],
        "opensuse-leap": [
            "/lib64/libacl.so.1",
            "/lib64/libz.so.1",
            "/usr/lib64/libpopt.so.0",
            "/usr/lib64/libslp.so.1",
            "/lib64/libc.so.6",
            "/lib64/libattr.so.1",
            "/usr/lib64/libcrypto.so.1.1",
            "/lib64/libpthread.so.0",
            "/lib64/ld-linux-x86-64.so.2",
            "/lib64/libdl.so.2",
            "/lib64/libreadline.so.7",
            "/lib64/libtinfo.so.6",
        ],
        "opensuse-tumbleweed": [
            "/lib64/libc.so.6",
            "/usr/lib64/libacl.so.1",
            "/lib64/libz.so.1",
            "/usr/lib64/libpopt.so.0",
            "/usr/lib64/libslp.so.1",
            "/lib64/ld-linux-x86-64.so.2",
            "/usr/lib64/libcrypto.so.1.1",
            "/lib64/libpthread.so.0",
            "/lib64/libdl.so.2",
            "/lib64/libreadline.so.8",
            "/lib64/libtinfo.so.6",
        ],
    }

    for l in libs_d[settings.OS_DISTRO_ID]:
        copy(l, "{}{}".format(chroot_loc, l))
    run_command([USERMOD, "-s", "/bin/bash", user], log=True)


def is_pub_key(key):
    fo, npath = mkstemp()
    with open(npath, "w") as tfo:
        tfo.write(key)
    try:
        run_command(["ssh-keygen", "-l", "-f", npath])
    except:
        return False
    finally:
        os.remove(npath)

    return True
