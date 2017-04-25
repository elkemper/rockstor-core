/*
 *
 * @licstart  The following is the entire license notice for the
 * JavaScript code in this page.
 *
 * Copyright (c) 2012-2017 RockStor, Inc. <http://rockstor.com>
 * This file is part of RockStor.
 *
 * Rockstor is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published
 * by the Free Software Foundation; either version 2 of the License,
 * or (at your option) any later version.
 *
 * Rockstor is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <http://www.gnu.org/licenses/>.
 *
 * @licend  The above is the entire license notice
 * for the JavaScript code in this page.
 *
 */

LuksDiskView = RockstorLayoutView.extend({
    events: {
        'click #cancel': 'cancel',
        'click #crypttab_selection': 'crypttab_selection_changed',
        'click #create_keyfile_tick': 'create_keyfile_tick_toggle'
    },

    initialize: function () {
        var _this = this;
        this.constructor.__super__.initialize.apply(this, arguments);
        this.template = window.JST.disk_luks_disk;
        this.disks = new DiskCollection();
        this.diskName = this.options.diskName;
        this.dependencies.push(this.disks);
        this.initHandlebarHelpers();
    },

    render: function () {
        this.fetch(this.renderDisksForm, this);
        return this;
    },


    renderDisksForm: function () {
        if (this.$('[rel=tooltip]')) {
            this.$('[rel=tooltip]').tooltip('hide');
        }
        var _this = this;
        var disk_name = this.diskName;
        // retrieve local copy of disk serial number
        var serialNumber = this.disks.find(function (d) {
            return (d.get('name') == disk_name);
        }).get('serial');
        // retrieve local copy of current disk role
        var diskRole = this.disks.find(function (d) {
            return (d.get('name') == disk_name);
        }).get('role');
        // get the btrfsuuid for this device
        var disk_btrfs_uuid = this.disks.find(function(d) {
            return (d.get('name') == disk_name);
        }).get('btrfs_uuid');
        // get the pool for this device
        var disk_pool = this.disks.find(function(d) {
            return (d.get('name') == disk_name);
        }).get('pool');
        // parse the diskRole json to a local object
        try {
            var role_obj = JSON.parse(diskRole);
        } catch (e) {
                // as we can't convert this drives role to json we assume
                // it's isRoleUsable status by false
            role_obj = null;
        }
        // extract our partitions obj from the role_obj if there is one.
        // @todo Could be used in the future to add js validation against
        // @todo partitioned LUKS containers, ie we leave them alone.
        var partitions;
        if (role_obj != null && role_obj.hasOwnProperty('partitions')) {
            partitions = role_obj.partitions;
        } else {
            // else we set our partitions to be an empty object
            partitions = {};
        }
        // extract any existing redirect role value.
        var current_redirect;
        if (role_obj != null && role_obj.hasOwnProperty('redirect')) {
            // if there is a redirect role then set our current role to it
            current_redirect = role_obj['redirect'];
        } else {
            current_redirect = '';
        }
        // set local convenience flag if device is a LUKS container.
        // and grab the luks_container_uuid if available
        var is_luks;
        // Establish a unique initial LUKS container uuid placeholder first,
        // just in case we end up some how without a LUKS role uuid key entry.
        // Important as we use this value to name keyfiles so must be clearly
        // identifiable and unique. UUID of actual container obviously better.
        var luks_container_uuid = disk_name;
        // While we are inside the LUKS role we can update current_crypttab
        // Assume we have no crypttab entry until we find otherwise.
        var current_crypttab_status = false;
        // Likewise we can also retrieve keyfile existence
        var keyfile_exists = false;
        if (role_obj !== null && role_obj.hasOwnProperty('LUKS')) {
            is_luks = true;
            if (role_obj['LUKS'].hasOwnProperty('uuid')) {
                luks_container_uuid = role_obj['LUKS']['uuid'];
            }
            // if we have a crypttab entry, extract it.
            if (role_obj['LUKS'].hasOwnProperty('crypttab')) {
                current_crypttab_status = role_obj['LUKS']['crypttab'];
            }
            if (role_obj['LUKS'].hasOwnProperty('keyfileExists')) {
                keyfile_exists = role_obj['LUKS']['keyfileExists'];
            }
        } else {
            is_luks = false;
        }
        // Populate our crypttab_selection text object along with values.
        // A value of false is used to indicate no crypttab entry exists.
        // see display_crypttab_entry handlebar helper below.
        // @todo In the future these options could be extended with a custom
        // @todo keyfile option to allow users to specify a keyfile with path.
        var crypttab_options = {
            'No auto unlock': false,
            'Manual passphrase via local console': 'none',
            'Auto unlock via keyfile': '/root/keyfile-' + luks_container_uuid
        };
        // additional convenience flag if device is an open LUKS volume.
        var is_open_luks;
        if (role_obj !== null && role_obj.hasOwnProperty('openLUKS')) {
            is_open_luks = true;
        } else {
            is_open_luks = false;
        }

        this.current_redirect = current_redirect;
        this.partitions = partitions;
        this.disk_btrfs_uuid = disk_btrfs_uuid;
        this.is_luks = is_luks;
        this.keyfile_exists = keyfile_exists;

        $(this.el).html(this.template({
            diskName: this.diskName,
            serialNumber: serialNumber,
            diskRole: diskRole,
            role_obj: role_obj,
            partitions: partitions,
            current_redirect: current_redirect,
            disk_btrfs_uuid: disk_btrfs_uuid,
            is_luks: is_luks,
            is_open_luks: is_open_luks,
            crypttab_options: crypttab_options,
            current_crypttab_status: current_crypttab_status,
            keyfile_exists: keyfile_exists,
            luks_container_uuid: luks_container_uuid
        }));

        this.$('#luks-disk-form :input').tooltip({
            html: true,
            placement: 'right'
        });

        var err_msg = '';
        var luks_err_msg = function () {
            return err_msg;
        };

        $.validator.addMethod('validateCrypttab_selection', function (value) {
            var crypttab_selection = $('#crypttab_selection').val();
            var create_keyfile_tick = $('#create_keyfile_tick');
            // Check to see if we are attempting to configure an auto unlock
            // via a non existent keyfile and not also requesting the creation
            // of that keyfile: ie ticked "create_keyfile_tick"
            if (!keyfile_exists) {
                if (crypttab_selection !== 'false' && crypttab_selection !== 'none') {
                    // auto unlock via keyfile selected
                    if (!create_keyfile_tick.prop('checked')) {
                        err_msg = '"Auto unlock via keyfile" selected when ' +
                            'the indicated keyfile does not exist. ' +
                            'Tick "Create keyfile" below.';
                        return false;
                    }
                }
            }
            return true;
        }, luks_err_msg);

        $.validator.addMethod('validateLuks_passphrase', function (value) {
            var create_keyfile_tick = $('#create_keyfile_tick');
            var luks_passphrase = $('#luks_passphrase').val();
            if (create_keyfile_tick.prop('checked')) {
                if (luks_passphrase === '') {
                    err_msg = 'Keyfile creation requested but no passphrase ' +
                        'entered';
                    return false;
                }
            }
            return true;
        }, luks_err_msg);


        this.$('#luks-disk-form').validate({
            onfocusout: false,
            onkeyup: false,
            rules: {
                crypttab_selection: 'validateCrypttab_selection',
                luks_passphrase: 'validateLuks_passphrase'
            },

            submitHandler: function () {
                var button = $('#role-disk');
                if (buttonDisabled(button)) return false;
                disableButton(button);
                var submitmethod = 'POST';
                var posturl = '/api/disks/' + disk_name + '/luks-drive';
                $.ajax({
                    url: posturl,
                    type: submitmethod,
                    dataType: 'json',
                    contentType: 'application/json',
                    data: JSON.stringify(_this.$('#luks-disk-form').getJSON()),
                    success: function () {
                        enableButton(button);
                        _this.$('#luks-disk-form :input').tooltip('hide');
                        app_router.navigate('disks', {trigger: true});
                    },
                    error: function (xhr, status, error) {
                        enableButton(button);
                    }
                });
                return false;
            }
        });
        this.container_or_volume_mode();
        this.show_keyfile_options();
        this.crypttab_selection_changed();
    },

    container_or_volume_mode: function () {
        if (this.is_luks) {
            // LUKS Container mode so show crypttab selection
            this.$('#crypttab_selection_group').show();
        } else {
            // Open LUKS volume mode assumed.
            this.$('#crypttab_selection_group').hide();
        }
    },

    crypttab_selection_changed: function () {
        var crypttab_selected = this.$('#crypttab_selection').val();
        if (crypttab_selected !== 'false' && crypttab_selected !== 'none') {
            // Assuming not false and not none is keyfile entry.
            this.show_keyfile_options(true);
        } else {
            this.show_keyfile_options(false);
        }
    },

    show_keyfile_options: function(show) {
        var keyfile_exists = this.keyfile_exists;
        if (show) {
            this.$('#current_keyfile_group').show();
            if (!keyfile_exists) {
                this.$('#create_keyfile_group').show();
            }
        } else {
            this.$('#current_keyfile_group').hide();
            this.$('#create_keyfile_group').hide();
        }
        this.create_keyfile_tick_toggle();
    },

    create_keyfile_tick_toggle: function () {
        // show or hide our associated UI authentication components according
        // to our own state. Currently authentication is limited to passphrase
        // entry. This could later be extended to keyfile selection, although
        // currently if the native keyfile exists we should not be displayed
        // due to redundancy, ie keyfile exists already.
        var create_keyfile_tick = this.$('#create_keyfile_tick');
        if (create_keyfile_tick.prop('checked')) {
            this.$('#luks_passphrase_group').show();
        } else {
            this.$('#luks_passphrase_group').hide();
        }
    },

    initHandlebarHelpers: function () {
        Handlebars.registerHelper('display_luks_container_or_volume', function () {
            var html = '';
            if (this.is_luks) {
                html += 'LUKS container configuration.';
            } else if (this.is_open_luks) {
                html += 'Open LUKS Volume information page.';
            } else {
                html += 'Warning: Non LUKS Device, please report bug on forum.';
            }
            return new Handlebars.SafeString(html);
        });
        Handlebars.registerHelper('display_create_keyfile_text', function () {
            // Customize our "create_keyfile_tick" user facing text.
            // Ie "Create the above keyfile if we don't have a custom keyfile
            // If we have a custom keyfile config that doesn't exist then we
            // must be clear that we create our native /root/keyfile-<uuid>
            // and alter the crypttab to match.
            // This is in lue of a fully configurable custom config option.
            var current_crypttab_status = this.current_crypttab_status;
            var html = '';
            var native_keyfile = '/root/keyfile-' + this.luks_container_uuid;
            if (current_crypttab_status !== native_keyfile) {
                html += 'Create keyfile (native)';
            } else {
                html += 'Create keyfile (as above)';
            }
            return new Handlebars.SafeString(html);
        });
        Handlebars.registerHelper('display_crypttab_entry', function () {
            // Helper to fill dropdown with crypttab relevant entries,
            // generating dynamically lines of the following format:
            // <option value="false">No auto unlock (No crypttab entry)
            // </option>
            var html = '';
            var current_crypttab_status = this.current_crypttab_status;
            for (var entry in this.crypttab_options) {
                // cycle through the available known entries and construct our
                // drop down html; using 'selected' to indicate current value.
                html += '<option value="' + this.crypttab_options[entry];
                if (current_crypttab_status === this.crypttab_options[entry]) {
                    // we have found our current setting so indicate this by
                    // pre-selecting it. N.B. exact matches only ie keyfile
                    // match in this case uses native naming ie:
                    // /root/keyfile-<uuid>.
                    html += '" selected="selected">';
                    html += entry + ' - active</option>';
                } else if ((current_crypttab_status !== false) &&
                    (current_crypttab_status.substring(0, 1) === '/') &&
                    (entry === 'Auto unlock via keyfile')) {
                    // @todo - the above clause is clumsy and could later be
                    // @todo - replaced with a custom cryptab file entry
                    // @todo - option in crypttab_options.
                    // We have a path entry (ie keyfile type) but not one
                    // using the native naming ie a non /root/keyfile-<uuid>.
                    // Indicate the selection type and "custom" nature.
                    html += '" selected="selected">';
                    html += entry + ' (custom) - active</option>';
                } else {
                    // construct non current entry
                    html += '">' + entry + '</option>';
                }
            }
            return new Handlebars.SafeString(html);
        });
        Handlebars.registerHelper('display_keyfile_path', function () {
            var html = '';
            var keyfile_entry = this.current_crypttab_status;
            // first check if we have a keyfile_entry ie non false
            // we shouldn't be called if there isn't one but just in case:
            if (keyfile_entry !== false && keyfile_entry !== 'none') {
                html += 'Configured Keyfile:&nbsp;&nbsp;';
            } else {
                html += 'Proposed Keyfile:&nbsp;&nbsp;';
            }
            // Redefine local keyfile_entry value to represent the native
            // keyfile if false (no cyrpttab entry) or 'none' manual. Slightly
            // unclean but we are done with it otherwise.
            if (keyfile_entry === false || keyfile_entry === 'none') {
                keyfile_entry = '/root/keyfile-' + this.luks_container_uuid;
            }
            if (this.keyfile_exists) {
                // green to denote existing keyfile_entry
                html += '<span style="color:darkgreen">'
                    + keyfile_entry + '</span>';
            } else {
                // red to denote missing keyfile_entry
                html += '<span style="color:darkred">'
                    + keyfile_entry;
                html += '<p><strong>WARNING: THE ABOVE KEY FILE DOES NOT EXIST</strong></span></p>';
            }
            return new Handlebars.SafeString(html);
        });
    },

    cancel: function (event) {
        event.preventDefault();
        this.$('#luks-disk-form :input').tooltip('hide');
        app_router.navigate('disks', {trigger: true});
    }

});




