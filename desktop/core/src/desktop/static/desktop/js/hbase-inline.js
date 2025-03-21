routie.setPathname('/hbase');


$(document).ready(function () {
    var hbaseOptionsElement = document.getElementById('hbaseOptions');
    hbaseOptions = JSON.parse(hbaseOptionsElement.textContent);

    var i18n_cache = {
        "Confirm Delete": "Confirm Delete",
        "Delete row ": "Delete row ",
        '? (This cannot be undone)': "? (This cannot be undone)",
        "Are you sure you want to drop this column?": "Are you sure you want to drop this column?",
        'enable': "enable",
        'disable': "disable",
        'Confirm': "Confirm",
        "Are you sure you want to": "Are you sure you want to",
        "this table?": "this table?",
        'End Query': "End Query",
        'Prefix Scan': "Prefix Scan",
        'Start Scan': "Start Scan",
        'Start Select Columns': "Start Select Columns",
        'End Column/Family': "End Column/Family",
        'End Select Columns': "End Select Columns",
        'Start FilterString': "Start FilterString",
        'End FilterString': "End FilterString",
        'Row Key Value': "Row Key Value",
        'Length of Scan or Row Key': "Length of Scan or Row Key",
        'Column Family: Column Name': "Column Family: Column Name",
        'Rows starting with': "Rows starting with",
        'String': "String",
        'Integer': "Integer",
        'Column Range': "Column Range"
    };

    function i18n(text) {
        if (text in i18n_cache)
            return i18n_cache[text];
        return text;
    };

    // update
    canWrite = hbaseOptions.can_write === 'True';
    
    var BaseModel = function () {
    }

    var ListViewModel = function (options) {
        var self = this, _defaults = {
            items: [],
            reload: function () {

            },
            sortFields: {}
        };
        options = ko.utils.extend(_defaults, options);
        BaseModel.apply(this, [options]);

        self.canWrite = ko.observable(options.canWrite);
        self.items = ko.observableArray(options.items);
        self.sortDropDown = new SortDropDownView({ sortFields: options.sortFields, target: self.items });

        self.selectAllVisible = function () {
            $.each(self.items(), function (index, item) {
                item.isSelected(item.isVisible());
            });
            return self;
        };

        self.deselectAll = function () {
            $.each(self.items(), function (index, item) {
                item.isSelected(false);
            });
            return self;
        };

        self.searchQuery = ko.observable('');

        self.allVisibleSelected = ko.computed(function () {
            if (self.items().length === 0) {
                return false;
            }
            var hasVisibleItems = false;
            for (var i = 0; i < self.items().length; i++) {
                if (!self.items()[i].isSelected() && self.items()[i].isVisible()) {
                    return false
                }
                hasVisibleItems = hasVisibleItems || self.items()[i].isVisible();
            }
            return hasVisibleItems;
        }, self);

        self.toggleSelectAll = function () {
            if (!self.allVisibleSelected()) {
                return self.selectAllVisible();
            }
            return self.deselectAll();
        };
        self.selected = ko.pureComputed(function () {
            return self.items().filter(function (item) {
                return item.isSelected();
            })
        });

        self.selectedAndVisible = ko.pureComputed(function () {
            return self.items().filter(function (item) {
                return item.isSelected() && item.isVisible();
            })
        });

        self.batchSelected = function (action) {
            var selected = self.selectedAndVisible();
            var batchCount = 0;

            for (q = 0; q < selected.length; q++) {
                self.isLoading(true);
                var call = action.apply(selected[q], arguments);
                var callback = function () {
                    batchCount++;
                    if (batchCount >= selected.length) {
                        self.reload();
                        self.isLoading(false);
                    }
                };
                if (call === true) {
                    callback();
                } else if (call != null && 'always' in call) {
                    call.always(callback);
                } else {
                    self.isLoading(false);
                }
            }
        };
        self.batchSelectedAlias = function (actionAlias) {
            self.batchSelected(function () {
                return this[actionAlias]();
            });
        };
        self.enableSelected = function () {
            self.batchSelected(function () {
                return this.enable();
            });
        };
        self.disableSelected = function () {
            confirm('Confirm Disable', 'Are you sure you want to disable the ' + self.selectedAndVisible().length + ' selected tables?', function () {
                self.batchSelected(function () {
                    return this.disable();
                });
            });
        };
        self.dropSelected = function () {
            confirm('Confirm Delete', 'Are you sure you want to drop the ' + self.selectedAndVisible().length + ' selected items? (WARNING: This cannot be undone!)', function () {
                self.batchSelected(function () {
                    var s = this;
                    self.droppedTables.push(s);
                    if (s.enabled && s.enabled()) {
                        self.isLoading(true);
                        return s.disable(function () {
                            s.drop(true);
                        });
                    } else {
                        return s.drop(true);
                    }
                });
            });
        };
        self.reload = function (callback) {
            self.items.removeAll();
            self.isLoading(true);
            options.reload.apply(self, [function () {
                if (callback != null)
                    callback();
                self.sortDropDown.sort();
                self.isLoading(false);
                if (self._table && self.searchQuery()) {
                    self._table.fnFilter(self.searchQuery());
                }
            }]);
        };
        self.isLoading = ko.observable(false);
        self.isReLoading = ko.observable(false);
        self.droppedTables = [];
    };

    var DataRow = function (options) {
        var self = this;
        ko.utils.extend(self, options); //applies options on itself
        BaseModel.apply(self, [options]);

        self.isVisible = ko.observable(true);
        self.isSelected = ko.observable(false);
        self.select = function () {
            self.isSelected(!self.isSelected());
        };
    };


    var utils = {
        //take an element with mustache templates as content and re-render
        renderElement: function (element, data) {
            element.html(window.Mustache.render(element.html(), data));
        },
        renderElements: function (selector, data) {
            if (selector == null || typeof (selector) == "undefined")
                selector = '';
            $(selector).each(function () {
                utils._renderElement(this);
            });
        },
        renderPage: function (page_selector, data) {
            return utils.renderElements('.' + PAGE_TEMPLATE_PREFIX + page_selector, data);
        },
        setTitle: function (title) {
            $('.page-title').text(title);
            return this;
        },
        getTitle: function () {
            return $('.page-title').text();
        }
    }


    function confirm(title, text, callback) {
        var modal = $('#confirm-modal');
        ko.cleanNode(modal[0]);
        modal.attr('data-bind', 'template: {name: "confirm_template"}');
        ko.applyBindings({
            title: title,
            text: text
        }, modal[0]);
        modal.find('.confirm-submit').click(callback);
        modal.modal('show');
    }

    window.launchModal = function (modal, data) {
        var element = $('#' + modal);
        ko.cleanNode(element[0]);
        element.attr('data-bind', 'template: {name: "' + modal + '_template"}');
        ko.applyBindings(data, element[0]);
        element.is('.ajaxSubmit') ? element.submit(bindSubmit) : '';
        switch (modal) {
            case 'cell_edit_modal':
                if (data.mime().split('/')[0] == 'text') {
                    var target = document.getElementById('ace_target_hidden');
                    var mime = data.mime();
                    var aceMode = 'ace/mode/text';
                    switch (mime) {
                        case 'text/json':
                            aceMode = 'ace/mode/json';
                            break;
                        case 'text/xml':
                            aceMode = 'ace/mode/xml';
                            break;
                    }
                    var editor = ace.edit('ace_target');
                    editor.setOptions({
                        readOnly: $('#ace_target').is(':disabled')
                    });
                    editor.setTheme(hueUtils.hueLocalStorage('hue.ace.theme') || 'ace/theme/hue');
                    editor.getSession().setMode(aceMode);
                    editor.setValue($(target).val(), -1);

                    data.ace = editor;

                    var updateTimeout = 0;
                    editor.on("change", function () {
                        clearTimeout(updateTimeout);
                        updateTimeout = setTimeout(function () {
                            data.value(editor.getValue());
                        }, 100);
                    });

                    data.showingCurrent.subscribe(function (showingCurrent) {
                        editor.setOption('readOnly', !showingCurrent)
                    });
                }
                app.focusModel(data.content);
                data.content.history.reload();

                if (data.content.parent) {
                    var path = '/hbase/api/putUpload/"' + app.cluster() + '"/"' + app.views.tabledata.name() + '"/"' + data.content.parent.row + '"/"' + data.content.name + '"';
                    var uploader = new qq.FileUploaderBasic({
                        button: document.getElementById("file-upload-btn"),
                        action: path,
                        fileFieldLabel: 'hbase_file',
                        multiple: false,
                        onComplete: function (id, fileName, response) {
                            data.content.reload(function () {
                                data.value(data.content.value());
                                data.mime(detectMimeType(data.value()))
                            });
                        }
                    });
                }
                break;
            case 'new_row_modal':
                $('a.action_addColumnValue').click(function () {
                    $(this).parent().find("ul").append("<li><input type=\"text\" name=\"column_values\" class=\"ignore\" placeholder = \"family:column_name\"/> <input type=\"text\" name=\"column_values\" class=\"ignore\" placeholder = \"cell_value\"/></li>")
                });
                break;
            case 'new_column_modal':
                var uploader = new qq.FileUploaderBasic({
                    button: document.getElementById("column-upload-btn"),
                    action: '',
                    fileFieldLabel: 'hbase_file',
                    multiple: false,
                    onComplete: function (id, fileName, response) {
                        if (response.status == null) {
                            data.reload();
                            element.modal('hide');
                        } else {
                            huePubSub.publish('hue.global.error', { message: $(response.response).find('div.alert strong').text() });
                        }
                    },
                    onSubmit: function () {
                        uploader._handler._options.action = '/hbase/api/putUpload/"' + app.cluster() + '"/"' + app.views.tabledata.name() + '"/' + prepForTransport(data.row) + '/"' + element.find('#new_column_name').val() + '"';
                    }
                });
                break;
        }
        if (!element.hasClass('in'))
            element.modal('show');
        hueAnalytics.log('hbase', modal.slice(0, modal.indexOf('_modal') != -1 ? modal.indexOf('_modal') : modal.length));
    }


    function parseXML(xml) {
        if (window.ActiveXObject) {
            var xmlDoc = new ActiveXObject("Microsoft.XMLDOM");
            xmlDoc.async = false;
            xmlDoc.loadXML(xml);
            return xmlDoc.xml;
        }
        if (window.DOMParser) {
            var xmlDoc = new DOMParser().parseFromString(xml, "text/xml");
            return new XMLSerializer().serializeToString(xmlDoc);
        }
        return xml;
    }

    function detectMimeType(data) {
        var MIME_TESTS = {
            'text/plain': function (data) {
                return !data;
            },
            'type/int': function (data) {
                return !isNaN(parseInt(data));
            },
            'text/json': function (data) {
                try {
                    return JSON.parse(data);
                }
                catch (err) {
                }
            },
            'text/xml': function (data) {
                if (window.ActiveXObject) {
                    return parseXML(data) != "";
                }
                return parseXML(data).indexOf('parsererror') == -1;
            }
        };
        var keys = Object.keys(MIME_TESTS);
        for (var i = 0; i < keys.length; i++) {
            if (MIME_TESTS[keys[i]](data))
                return keys[i];
        }
        //images
        var types = ['image/png', 'image/gif', 'image/jpg', 'application/pdf']
        var b64 = ['iVBORw', 'R0lG', '/9j/', 'JVBERi']
        try {
            var decoded = atob(data).toLowerCase().trim();
            for (var i = 0; i < types.length; i++) {
                var location = decoded.indexOf(types[i].split('/')[1]);
                if (location >= 0 && location < 10) //stupid guess
                    return types[i];
            }
        }
        catch (error) {
        }
        for (var i = 0; i < types.length; i++) {
            if (data.indexOf(b64[i]) >= 0 && data.indexOf(b64[i]) <= 10)
                return types[i];
        }
        return 'type/null';
    }

    function resetElements() {
        $(window).unbind('scroll');
        $(window).scroll(function (e) {
            $(".subnav.sticky").each(function () {
                var padder = $(this).data('padder'), top = $(this).position().top + (padder ? window.scrollY : 0);
                if (padder && top <= padder.position().top) {
                    $(this).removeClass('subnav-fixed').data('padder').remove();
                    $(this).removeData('padder');
                }
                else if (!padder && top <= window.scrollY + $('.navbar').outerHeight()) {
                    $(this).addClass('subnav-fixed').data('padder', $('<div></div>').insertBefore($(this)).css('height', $(this).outerHeight()));
                }
            });
        });
        app.views.tabledata.showGrid(false);
    };

    function resetSearch() {
        app.views.tabledata.searchQuery('');
        app.search.cur_input('');
    };

    function prepForTransport(value) {
        value = value.replace(/\"/g, '\\\"').replace(/\//g, '\\/');
        if (isNaN(parseInt(value)) && value.trim() != '')
            value = '"' + value + '"';
        return encodeURIComponent(value);
    };

    function table_search(value) {
        routie(app.cluster() + '/' + app.views.tabledata.name() + '/query/' + value);
    }

    function getEditablePosition(contentEditable, trimWhitespaceNodes) {
        var el = contentEditable;
        if (window.getSelection().getRangeAt(0).startContainer == el) //raw reference for FF fix
            return 0;
        var index = window.getSelection().getRangeAt(0).startOffset; //ff
        var cur_node = window.getSelection().getRangeAt(0).startContainer; //ff
        while (cur_node != null && cur_node != el) {
            var cur_sib = cur_node.previousSibling || cur_node.previousElementSibling;
            while (cur_sib != null) {
                var val = $(cur_sib).text() || cur_sib.nodeValue;
                if (typeof val !== "undefined" && val != null) {
                    index += trimWhitespaceNodes ? val.length : val.length;
                }
                cur_sib = cur_sib.previousSibling;
            }
            cur_node = cur_node.parentNode;
        }
        return index;
    };

    function setCursor(node, pos, trimWhitespaceNodes) {
        var sel = window.getSelection();
        var range = document.createRange();
        node = function selectNode(node) {
            var nodes = node.childNodes;
            if (pos > 0) {
                for (var i = 0; i < nodes.length; i++) {
                    var val = trimWhitespaceNodes ? nodes[i].nodeValue.trim() : nodes[i].nodeValue;
                    if (val) {
                        if (val.length >= pos) {
                            return nodes[i];
                        } else {
                            pos -= val.length;
                        }
                    }
                    var n = selectNode(nodes[i]);
                    if (n) return n;
                }
            }
            return false;
        }(node);
        try {
            range.setStart(node, pos);
            range.setEnd(node, pos);
            range.collapse(true);
            sel.removeAllRanges();
            sel.addRange(range);
            return range;
        } catch (err) {
        }
    }

    function pullFromRenderer(str, renderer) {
        try {
            return str.match(renderer.select)[0].match(renderer.tag)[0];
        } catch (e) {
            return "";
        }
    }

    window.selectIndex = null;
    var fallback = typeof window.getSelection === "undefined";
    ko.bindingHandlers.editableText = {
        init: function (element, valueAccessor, allBindingsAccessor) {
            $(element).on('keydown', function () {
                setTimeout(function () {
                    var modelValue = valueAccessor();
                    var elementValue = $(element).text();
                    if (ko.isWriteableObservable(modelValue) && elementValue != modelValue()) {
                        if (!fallback)
                            window.selectIndex = getEditablePosition(element); //firefox does some tricky predictive stuff here
                        modelValue(elementValue);
                    }
                    else { //handle non-observable one-way binding
                        var allBindings = allBindingsAccessor();
                        if (allBindings['_ko_property_writers'] && allBindings['_ko_property_writers'].htmlValue) allBindings['_ko_property_writers'].htmlValue(elementValue);
                    }
                }, 1);
            });
        },
        update: function (element, valueAccessor) {
            var value = ko.utils.unwrapObservable(valueAccessor()) || "";
            if (value.trim() == "" && !app.search.focused()) {
                app.search.doBlur();
            } else {
                if (!fallback) {
                    element.innerHTML = app.search.render(value, searchRenderers);
                    if (window.selectIndex != null) {
                        setCursor(element, window.selectIndex);
                    }
                }
            }
        }
    };


    var API = {
        //base querying function
        //query(functionName, ClusterName, arg0, arg1).done(callback)
        query: function () {
            // all url building should be in this function
            var url = "/hbase/api";
            var $_POST = {};
            for (var i = 0; i < arguments.length; i++) {
                if (arguments[i] == null)
                    arguments[i] = "";
                arguments[i] = arguments[i] + "";
                var key = arguments[i].slice(0, 15);
                if (key == "hbase-post-key-") {
                    key += Object.keys($_POST).length;
                    $_POST[key] = arguments[i].slice(15);
                    arguments[i] = key;
                }
                url += '/' + encodeURIComponent(arguments[i]);
            }
            var queryObject = { url: url, method: 'POST', startTime: new Date().getTime(), status: 'running...' };
            var functionName = arguments.length > 0 ? arguments[0] : '';
            var handler = $.post(url, $_POST).fail(function (response) {
                if (functionName !== 'getColumnDescriptors') {
                    huePubSub.publish('hue.global.error', { message: JSON.parse(response.responseText).message });
                }
            });
            var doneHandle = handler.done;
            handler.done = function () {
                var cb = arguments[0];
                return doneHandle.apply(handler, [function (data) {
                    app.views.tabledata.truncateLimit(data.limit);
                    data = data.data;
                    return cb(data);
                }].concat(Array.prototype.slice.call(arguments).slice(1)));
            };
            return handler;
        },
        queryArray: function (action, args) {
            return API.query.apply(this, [action].concat(args));
        },
        //function,arg0,arg1, queries the current cluster
        queryCluster: function () {
            var args = Array.prototype.slice.call(arguments);
            args.splice(1, 0, app.cluster());
            return API.query.apply(this, args);
        },
        queryTable: function () {
            var args = Array.prototype.slice.call(arguments);
            args.splice(1, 0, app.views.tabledata.name());
            return API.queryCluster.apply(this, args);
        },
        //functions to abstract away API structure, in case API changes:
        //only have function name, data, and callbacks. no URL or api-facing.
        createTable: function (cluster, tableName, columns, callback) {
            return API.query('createTable', cluster, tableName, columns).done(callback);
        },
        getTableNames: function (cluster, callback) {
            return API.query('getTableNames', cluster).done(callback);
        },
        getTableList: function (cluster, callback) {
            return API.query('getTableList', cluster).done(callback);
        }
    }


    var searchRenderers = {
        'rowkey': { //class to tag selection
            select: /[^\,\{\[]+(([\{\[][^\}\]]+[\}\]])+|)([^\,]+|)/g, //select the substring to process, useful as JS has no lookbehinds old: ([^,]+\[([^,]+(,|)+)+\]|[^,]+)
            tag: /.+/g, //select the matches to wrap with tags
            nested: {
                'scan': { select: /(([^\\]|\b)\+[0-9]+)/g, tag: /\+[0-9]+/g },
                'columns': {
                    select: /\[.+\]/g,
                    tag: /[^,\[\]]+/g, //forced to do this select due to lack of lookbehinds /[\[\]]/g
                    nested: {
                        'range': {
                            select: /\sto\s/g,
                            tag: /.+/g
                        }
                    }
                },
                'prefix': { select: /[^\*\\]+\*/g, tag: /\*/g },
                'filter': {
                    select: /\{[^\{\}]+\}/,
                    tag: /[^\{\}]+/g,
                    nested: {
                        'linker': {
                            select: /\ (AND|OR|SKIP|WHILE)\ /g,
                            tag: /.+/g
                        }/*,
          'compare_op': {
          select: /[\<\=\!\>]{1,2}/g,
          tag: /.+/g
          }*/ //will be added eventually after html bug is figured out
                    }
                }
            }
        }
    };

    var DataTableViewModel = function (options) {
        var self = this, _defaults = {
            name: '',
            columns: [],
            items: [],
            reload: function () {

            },
            el: ''
        };
        options = ko.utils.extend(_defaults, options);
        ListViewModel.apply(this, [options]);

        self.name = ko.observable(options.name);
        self.searchQuery.subscribe(function (value) {
            self._table.fnFilter(value);
            for (var i = 0; i < self.items().length; i++) {
                self.items()[i].isVisible(false);
            }
            var visibleRows = self._table.find("tbody > tr");
            for (var i = 0; i < visibleRows.length; i++) {
                var boundData = ko.dataFor(visibleRows[i]);
                // Elements that were once filtered out by datatable search does not update when shown again, re-binding fixes this.
                ko.cleanNode(visibleRows[i]);
                ko.applyBindings(boundData, visibleRows[i]);
                if (ko.isObservable(boundData.isVisible)) {
                    ko.dataFor(visibleRows[i]).isVisible(true);
                }
            }
        });
        self.columns = ko.observableArray(options.columns);
        self._el = $('table[data-datasource="' + options.el + '"]');
        self._table = null;
        self._initTable = function () {
            if (!self._table) {
                self._table = self._el.dataTable({
                    "aoColumnDefs": [
                        { "bSortable": false, "aTargets": [0] }
                    ],
                    "sDom": 'tr',//this has to be in, change to sDom so you can call filter()
                    'bAutoWidth': false,
                    "iDisplayLength": -1
                });
                return self._table;
            }
        };
        self.sort = function (viewModel, event) {
            var el = $(event.currentTarget);
        };
        var _reload = self.reload;
        self.reload = function (callback) {
            if (self._table) {
                self._table.fnClearTable();
                self._table.fnDestroy();
                self._table = null;
            }
            _reload(function () {
                self._initTable();
                if (callback != null)
                    callback();
            });
        };

        self.canDrop = ko.computed(function () {
            var selected = self.selectedAndVisible();
            if (selected.length <= 0) return false;
            for (var i = 0; i < selected.length; i++) {
                if (selected[i].enabled()) return false;
            }
            return true;
        });

        self.canDisable = ko.computed(function () {
            var selected = self.selectedAndVisible();
            if (selected.length <= 0) return false;
            for (var i = 0; i < selected.length; i++) {
                if (!selected[i].enabled()) return false;
            }
            return true;
        });

        self.canEnable = ko.computed(function () {
            var selected = self.selectedAndVisible();
            if (selected.length <= 0) return false;
            for (var i = 0; i < selected.length; i++) {
                if (selected[i].enabled()) return false;
            }
            return true;
        });
    };

    //a Listview of Listviews
    var SmartViewModel = function (options) {
        var self = this;
        options = ko.utils.extend({
            name: '',
            items: [],
            reload: function () {

            },
            el: '',
            sortFields: {
                'Row Key': function (a, b) {
                    return a.row.localeCompare(b.row);
                },
                'Column Count': function (a, b) {
                    a = a.items().length;
                    b = b.items().length;
                    if (a > b)
                        return 1;
                    if (a < b)
                        return -1;
                    return 0;
                },
                'Row Key Length': function (a, b) {
                    a = a.row.length;
                    b = b.row.length;
                    if (a > b)
                        return 1;
                    if (a < b)
                        return -1;
                    return 0;
                }
            },
            canWrite: false
        }, options);
        ListViewModel.apply(this, [options]); //items: [ListView.items[],ListView.items[]]

        self.columnFamilies = ko.observableArray();
        self.name = ko.observable(options.name);
        self.name.subscribe(function (val) {
            if (!val) return;
            self.columnFamilies([]);
            self._reloadcfs();
            if (app.station() == 'table' && app.search.cur_input())
                return;
            self.querySet.removeAll();
            self.evaluateQuery();
        }); //fix and decouple

        self.lastReloadTime = ko.observable(1);

        self.searchQuery.subscribe(function (value) //make this as nice as the render function and split into two, also fire not down on keyup events
        {
            if (app.station() != 'table')
                return;
            if (value.replace(/\s/g, "") == '' || value == null)
                routie(app.cluster() + '/' + app.views.tabledata.name());
            var inputs = value.match(searchRenderers['rowkey']['select']);
            self.querySet.removeAll();
            if (inputs) {
                for (var i = 0; i < inputs.length; i++) {
                    if (inputs[i].trim() != "" && inputs[i].trim() != ',') {
                        //pull out filters
                        var filter = inputs[i].match(searchRenderers['rowkey']['nested']['filter']['select']) || "";
                        filter = filter != null && filter.length > 0 ? escape(filter[0].trim().slice(1, -1)) : "";

                        function filterPostfix(postfix) {
                            return (filter != null && filter.length > 0 ? ' AND ' : ' ') + postfix;
                        }

                        //pull out columns
                        var extract = inputs[i].match(searchRenderers['rowkey']['nested']['columns']['select']);
                        var columns = extract != null ? extract[0].match(searchRenderers['rowkey']['nested']['columns']['tag']) : [];
                        inputs[i] = inputs[i].replace(extract, '');

                        //pull out scan
                        var p = pullFromRenderer(inputs[i], searchRenderers['rowkey']['nested']['scan']);
                        inputs[i] = inputs[i].replace(p, '');
                        p = p.split('+');
                        var scan = p.length > 1 ? parseInt(p[1].trim()) : 0;

                        //pull out column filters
                        var toRemove = [];
                        var cfs = [];
                        for (var n = 0; n < columns.length; n++) {
                            var o = columns[n];
                            if (columns[n].match(searchRenderers['rowkey']['nested']['columns']['nested']['range']['select'])) {
                                var partitions = columns[n].split(searchRenderers['rowkey']['nested']['columns']['nested']['range']['select']);
                                filter += filterPostfix("ColumnRangeFilter('" + partitions[0] + "', false, '" + partitions[1] + "', true)");
                                toRemove.push(n);
                            } else {
                                if (o.indexOf(':') == -1) {
                                    toRemove.push(n);
                                    //for each column family push cf and then column
                                    $(self.columnFamilies()).each(function (i, item) {
                                        columns.push(item.name + o);
                                    });
                                    continue;
                                } else {
                                    o = o.slice(o.indexOf(':') + 1);
                                }
                                var colscan = pullFromRenderer(o, searchRenderers['rowkey']['nested']['scan']);
                                if (colscan) {
                                    colscan = parseInt(colscan.split('+')[1]) + 1;
                                    filter += filterPostfix("ColumnPaginationFilter(" + colscan + ", 0)");
                                }
                                var fc = o.replace(pullFromRenderer(o, searchRenderers['rowkey']['nested']['prefix']), '');
                                if (fc != o) {
                                    filter += filterPostfix("ColumnPrefixFilter('" + o.match(/[^:*]+/g)[0] + "')");
                                    columns[n] = columns[n].split(':')[0] + ':';
                                }
                            }
                        }

                        for (var n = toRemove.length - 1; n >= 0; n--) {
                            columns.splice(toRemove[n], 1);
                        }
                        ;

                        self.querySet.push(new QuerySetPiece({
                            'row_key': inputs[i].replace(/\\(\+|\*|\,)/g, '$1').replace(/[\[\{].+[\]\}]|\*/g, '').trim(), //clean up with column regex selectors instead
                            'scan_length': scan ? scan + 1 : 1,
                            'columns': columns,
                            'prefix': inputs[i].match(searchRenderers['rowkey']['nested']['prefix']['select']) != null,
                            'filter': filter.length > 0 ? filter : null
                        }));
                    }
                }
            }
            self.evaluateQuery();
        });

        self._reloadcfs = function (callback) {
            var descriptorCallback = function (data) {
                self.columnFamilies.removeAll();
                var keys = Object.keys(data);
                for (var i = 0; i < keys.length; i++) {
                    self.columnFamilies.push(new ColumnFamily({ name: keys[i], enabled: false }));
                }
                if (typeof callback !== 'undefined' && callback !== null) {
                    callback();
                }
            }

            return API.queryTable("getColumnDescriptors").done(descriptorCallback).fail(function () {
                descriptorCallback({});
            });
        };

        self.columnQuery = ko.observable("");
        self.columnQuery.subscribe(function (query) {
            var dataRowFilter = function (index, data_row) {
                data_row.searchQuery(query);
            };
            if (self.selected().length > 0) {
                $.each(self.selected(), dataRowFilter);
            } else {
                $.each(self.items(), dataRowFilter);
            }
        });

        self.rows = ko.computed(function () {
            var a = [];
            var items = this.items();
            for (var i = 0; i < items.length; i++) {
                a.push(items[i].row);
            }
            return a;
        }, self);

        self.querySet = ko.observableArray();
        self.validateQuery = function () {
            if (self.querySet().length == 0) {
                self.querySet.push(new QuerySetPiece({
                    'row_key': 'null',
                    'scan_length': 10,
                    'prefix': 'false'
                }));
            } else {
                $(self.querySet()).each(function () {
                    this.validate();
                    this.editing(false);
                });
            }
        };
        self.addQuery = function () {
            self.validateQuery();
            self.querySet.push(new QuerySetPiece({
                onValidate: function () {
                    //self.reload();
                }
            }))
        };
        self.evaluateQuery = function (callback) {
            self.validateQuery();
            self.reload(callback);
        };
        var _reload = self.reload;
        self.reload = function (callback) {
            var queryStart = new Date();
            _reload(function () {
                self.lastReloadTime((new Date() - queryStart) / 1000);
                if (callback != null)
                    callback();
                self.isLoading(false);
            });
        };

        self.showGrid = ko.observable(false);
        self.showGrid.subscribe(function (val) {
            if (val) {
                var rows = self.items();
                var columns = {};
                //build full lookup hash of columns
                for (var i = 0; i < rows.length; i++) {
                    var cols = rows[i].items();
                    for (var q = 0; q < cols.length; q++) {
                        if (!columns[cols[q].name])
                            columns[cols[q].name] = "";
                    }
                }

                for (var i = 0; i < rows.length; i++) {
                    //clone blank template from hash
                    var new_row = $.extend({}, columns);
                    var cols = rows[i].items();
                    var col_list = [];
                    //set existing values
                    for (var q = 0; q < cols.length; q++) {
                        new_row[cols[q].name] = cols[q];
                    }
                    //build actual row from hash
                    var keys = Object.keys(new_row);
                    for (var r = 0; r < keys.length; r++) {
                        if (!new_row[keys[r]]) new_row[keys[r]] = new ColumnRow({ name: keys[r], value: '', parent: rows[i] });
                        col_list.push(new_row[keys[r]]);
                    }
                    //set and sort
                    rows[i].items(col_list);
                    rows[i].sortDropDown.sort();
                }
            } else {
                self.reload();
            }
        });

        self.truncateLimit = ko.observable(1500);

        self.reachedLimit = ko.computed(function () {
            var items = self.items();
            for (var i = 0; i < items.length; i++) {
                if (self.truncateLimit() < items[i].items().length) return true;
            }
            return false;
        });
    };

    var SmartViewDataRow = function (options) {
        var self = this;
        options = ko.utils.extend({
            sortFields: {
                'Column Family': function (a, b) {
                    return a.name.localeCompare(b.name);
                },
                'Column Name': function (a, b) {
                    return a.name.split(':')[1].localeCompare(b.name.split(':')[1]);
                },
                'Cell Size': function (a, b) {
                    a = a.value().length;
                    b = b.value().length;
                    if (a > b)
                        return 1;
                    if (a < b)
                        return -1;
                    return 0;
                },
                'Cell Value': function (a, b) {
                    return a.value().localeCompare(b.value());
                },
                'Timestamp': function (a, b) {
                    a = parseInt(a.timestamp);
                    b = parseInt(b.timestamp);
                    if (a > b)
                        return 1;
                    if (a < b)
                        return -1;
                    return 0;
                },
                'Column Name Length': function (a, b) {
                    a = a.name.split(':')[1].length;
                    b = b.name.split(':')[1].length;
                    if (a > b)
                        return 1;
                    if (a < b)
                        return -1;
                    return 0;
                }
            },
            canWrite: false
        }, options);
        DataRow.apply(self, [options]);
        ListViewModel.apply(self, [options]);

        self.displayedItems = ko.observableArray();

        self.displayRangeStart = 0;
        self.displayRangeLength = 20;
        self.items.subscribe(function () {
            self.displayedItems([]);
            self.updateDisplayedItems();
        });

        self.searchQuery.subscribe(function (searchValue) {
            self.scrollLoadSource = ko.computed(function () {
                return self.items().filter(function (column) {
                    return column.name.toLowerCase().indexOf(searchValue.toLowerCase()) != -1;
                });
            });
            self.displayRangeLength = 20;
            self.updateDisplayedItems();
        });

        self.scrollLoadSource = self.items;

        self.updateDisplayedItems = function () {
            var x = self.displayRangeStart;
            self.displayedItems(self.scrollLoadSource().slice(x, x + self.displayRangeLength));
        };

        self.resetScrollLoad = function () {
            self.scrollLoadSource = self.items;
            self.updateDisplayedItems();
        };

        self.isCollapsed = ko.observable(false);

        self.toggleSelectedCollapse = function () {
            if (!self.isCollapsed()) {
                self.displayedItems(self.displayedItems().filter(function (item) {
                    return item.isSelected();
                }));
                self.scrollLoadSource = self.displayedItems;
                self.isCollapsed(true);
            }
            else {
                self.isCollapsed(false);
                self.resetScrollLoad();
            }
        };

        self.onScroll = function (target, ev) {
            var displayRangeDelta = 15;
            if ($(ev.target).scrollLeft() == ev.target.scrollWidth - ev.target.clientWidth) {
                if (self.displayedItems().length < self.scrollLoadSource().length) {
                    self.displayRangeLength += displayRangeDelta;
                    self.updateDisplayedItems();
                } else {
                    self.displayRangeLength = self.items().length + displayRangeDelta;
                    var validate = self.items().length;
                    API.queryTable('getRowPartial', prepForTransport(self.row), self.items().length, 100).done(function (data) {
                        if (self.items().length != validate) return false;
                        var cols = data[0].columns;
                        var keys = Object.keys(cols);
                        var temp = [];
                        for (var i = 0; i < keys.length; i++) {
                            var col = cols[keys[i]];
                            temp.push(new ColumnRow({
                                name: keys[i],
                                timestamp: col.timestamp,
                                value: col.value,
                                parent: self
                            }));
                        }
                        self.items(self.items().concat(temp));
                    });
                }
            }
        };

        self.drop = function (cont) {
            function doDrop() {
                self.isLoading(true);
                return API.queryTable('deleteAllRow', self.row, "{}").always(function () {
                    app.views.tabledata.items.remove(self); //decouple later
                    self.isLoading(false);
                });
            }

            (cont === true) ? doDrop() : confirm(i18n("Confirm Delete"), i18n('Delete row ') + self.row + i18n('? (This cannot be undone)'), doDrop);
        };

        self.setItems = function (cols) {
            var colKeys = Object.keys(cols);
            var items = [];
            for (var q = 0; q < colKeys.length; q++) {
                items.push(new ColumnRow({
                    name: colKeys[q],
                    timestamp: cols[colKeys[q]].timestamp,
                    value: cols[colKeys[q]].value,
                    parent: self
                }));
            }
            self.items(items);
            return self.items();
        };

        self.selectAllVisible = function () {
            for (t = 0; t < self.displayedItems().length; t++)
                self.displayedItems()[t].isSelected(true);
            return self;
        };

        self.deselectAllVisible = function () {
            for (t = 0; t < self.displayedItems().length; t++)
                self.displayedItems()[t].isSelected(false);
            return self;
        };

        self.toggleSelectAllVisible = function () {
            if (self.selected().length != self.displayedItems().length)
                return self.selectAllVisible();
            return self.deselectAllVisible();
        };

        self.push = function (item) {
            var column = new ColumnRow(item);
            self.items.push(column);
        };

        var _reload = self.reload;
        self.reload = function (callback) {
            hueAnalytics.log('hbase', 'get_row');
            _reload(function () {
                if (callback != null)
                    callback();
                self.isLoading(false);
            });
        };
    };

    var ColumnRow = function (options) {
        var self = this;
        ko.utils.extend(self, options);
        DataRow.apply(self, [options]);

        self.value = ko.observable(self.value);
        self.history = new CellHistoryPage({
            row: self.parent.row,
            column: self.name,
            timestamp: self.timestamp,
            items: []
        });
        self.drop = function (cont) {
            function doDrop() {
                hueAnalytics.log('hbase', 'filter_columns');
                self.parent.isLoading(true);
                return API.queryTable('deleteColumn', prepForTransport(self.parent.row), prepForTransport(self.name)).done(function (data) {
                    self.parent.items.remove(self);
                    if (self.parent.items().length > 0)
                        self.parent.reload(); //change later
                    self.parent.isLoading(false);
                });
            }

            (cont === true) ? doDrop() : confirm(i18n("Confirm Delete"), i18n("Are you sure you want to drop this column?"), doDrop);
        };

        self.reload = function (callback, skipPut) {
            self.isLoading(true);
            API.queryTable('get', prepForTransport(self.parent.row), prepForTransport(self.name), 'null').done(function (data) {
                if (data.length > 0 && !skipPut)
                    self.value(data[0].value);
                if (typeof callback !== "undefined" && callback != null)
                    callback();
                self.isLoading(false);
            });
        };

        self.value.subscribe(function (value) {
            //change transport prep to object wrapper
            hueAnalytics.log('hbase', 'put_column');
            API.queryTable('putColumn', prepForTransport(self.parent.row), prepForTransport(self.name), "hbase-post-key-" + JSON.stringify(value)).done(function (data) {
                self.reload(function () {
                }, true);
            });
            self.editing(false);
        });

        self.editing = ko.observable(false);

        self.isLoading = ko.observable(false); //move to baseclass
    };

    var SortDropDownView = function (options) {
        var self = this;
        options = ko.utils.extend({
            sortFields: {},
            target: null
        }, options);
        BaseModel.apply(self, [options]);

        self.target = options.target;
        self.sortAsc = ko.observable(true);
        self.sortAsc.subscribe(function () {
            self.sort()
        });
        self.sortField = ko.observable("");
        self.sortField.subscribe(function () {
            self.sort()
        });
        self.sortFields = ko.observableArray(Object.keys(options.sortFields)); // change to ko.computed?
        self.sortFunctionHash = ko.observable(options.sortFields);
        self.toggleSortMode = function () {
            self.sortAsc(!self.sortAsc());
        };
        self.sort = function () {
            if (!self.target || !(self.sortFields().length > 0)) return;
            self.target.sort(function (a, b) {
                return (self.sortAsc() ? 1 : -1) * self.sortFunctionHash()[self.sortField() ? self.sortField() : self.sortFields()[0]](a, b); //all sort functions must sort by ASC for default
            });
        };
    };

    var TableDataRow = function (options) {
        var self = this;
        options = ko.utils.extend({
            name: "",
            enabled: true
        }, options);
        DataRow.apply(self, [options]);

        self.name = options['name'];
        self.enabled = ko.observable(options['enabled']);
        self.toggle = function (viewModel, event) {
            var action = [i18n('enable'), i18n('disable')][self.enabled() << 0], el = $(event.currentTarget);
            confirm(i18n("Confirm") + " " + action, i18n("Are you sure you want to") + " " + action + " " + i18n("this table?"), function () {
                el.showIndicator();
                return self[action](el).always(function () {
                    el.hideIndicator();
                });
            });
        };
        self.enable = function (el) {
            return API.queryCluster('enableTable', self.name).always(function () {
                self.enabled(true);
            });
        };
        self.disable = function (callback) {
            return API.queryCluster('disableTable', self.name).always(function () {
                self.enabled(false);
                if ($.isFunction(callback)) callback();
            });
        };
        self.drop = function (el) {
            return API.queryCluster('deleteTable', self.name);
        };
    };

    var QuerySetPiece = function (options) {
        var self = this;
        options = ko.utils.extend({
            row_key: "null",
            scan_length: 1,
            prefix: false,
            columns: [],
            filter: null,
            onValidate: function () {
            }
        }, options);
        BaseModel.apply(self, [options]);

        self.row_key = ko.observable(options.row_key);
        self.scan_length = ko.observable(options.scan_length);
        self.columns = ko.observableArray(options.columns);
        self.prefix = ko.observable(options.prefix);
        self.filter = ko.observable(options.filter);
        self.editing = ko.observable(true);

        self.validate = function () {
            if (self.scan_length() <= 0 || self.row_key() == "")
                return app.views.tabledata.querySet.remove(self); //change later
            return options.onValidate();
        };
        self.row_key.subscribe(self.validate.bind());
        self.scan_length.subscribe(self.validate.bind());
    };

    var ColumnFamily = function (options) {
        this.name = options.name;
        this.enabled = ko.observable(options.enabled);
        this.toggle = function () {
            this.enabled(!this.enabled());
            app.views.tabledata.reload();
        };
    }


    //tagsearch
    var tagsearch = function () {
        var self = this;
        self.tags = ko.observableArray();
        self.mode = ko.observable('idle');
        self.cur_input = ko.observable('');
        self.submitted = ko.observable(false);
        self.filters = ["KeyOnlyFilter ()", "FirstKeyOnlyFilter ()", "PrefixFilter ('row_prefix')", "ColumnPrefixFilter('column_prefix')", "MultipleColumnPrefixFilter('column_prefix', 'column_prefix', …, 'column_prefix')", "ColumnCountGetFilter (limit)", "PageFilter (page_size)", "ColumnPaginationFilter(limit, offset)", "InclusiveStopFilter('stop_row_key')", "TimeStampsFilter (timestamp, timestamp, ... ,timestamp)", "RowFilter (compareOp, 'row_comparator')", "QualifierFilter (compareOp, 'qualifier_comparator')", "QualifierFilter (compareOp,'qualifier_comparator')", "ValueFilter (compareOp,'value_comparator')", "DependentColumnFilter ('family', 'qualifier', boolean, compare operator, 'value comparator')", "DependentColumnFilter ('family', 'qualifier', boolean)", "DependentColumnFilter ('family', 'qualifier')", "SingleColumnValueFilter('family', 'qualifier', compare operator, 'comparator', filterIfColumnMissing_boolean, latest_version_boolean)", "SingleColumnValueFilter('family', 'qualifier', compare operator, 'comparator')", "SingleColumnValueExcludeFilter('family', 'qualifier', compare operator, 'comparator', latest_version_boolean, filterIfColumnMissing_boolean)", "SingleColumnValueExcludeFilter('family', 'qualifier', compare operator, 'comparator')", "ColumnRangeFilter ('minColumn', minColumnInclusive_bool, 'maxColumn', maxColumnInclusive_bool)"];
        self.hints = ko.observableArray([
            {
                hint: i18n('End Query'),
                shortcut: ',',
                mode: ['rowkey', 'prefix', 'scan'],
                selected: false
            },
            {
                hint: i18n('Prefix Scan'),
                shortcut: '*',
                mode: ['rowkey', 'columns'],
                selected: false
            },
            {
                hint: i18n('Start Scan'),
                shortcut: '+',
                mode: ['rowkey', 'prefix', 'columns'],
                selected: false
            },
            {
                hint: i18n('Start Select Columns'),
                shortcut: '[',
                mode: ['rowkey', 'prefix'],
                selected: false
            },
            {
                hint: i18n('End Column/Family'),
                shortcut: ',',
                mode: ['columns'],
                selected: false
            },
            {
                hint: i18n('End Select Columns'),
                shortcut: ']',
                mode: ['columns'],
                selected: false
            },
            {
                hint: i18n('Column Range'),
                shortcut: ' to ',
                mode: ['columns'],
                selected: false
            },
            {
                hint: i18n('Start FilterString'),
                shortcut: '{',
                mode: ['rowkey'],
                selected: false
            },
            {
                hint: i18n('End FilterString'),
                shortcut: '}',
                mode: ['filter'],
                selected: false
            }
        ]);
        self.activeHints = ko.computed(function () {
            var ret = [];
            $(self.hints()).each(function (i, hint) {
                if (hint.mode.indexOf(self.mode()) > -1)
                    ret.push(hint);
            });
            return ret;
        });
        self.activeHint = ko.observable(-1);
        self.modes = {
            'rowkey': {
                hint: i18n('Row Key Value'),
                type: i18n('String')
            },
            'scan': {
                hint: i18n('Length of Scan or Row Key'),
                type: i18n('Integer')
            },
            'columns': {
                hint: i18n('Column Family: Column Name'),
                type: i18n('String')
            },
            'prefix': {
                hint: i18n('Rows starting with'),
                type: i18n('String')
            },
            'filter': {
                hint: i18n('Thrift FilterString'),
                type: i18n('String')
            }
        }

        self.modeQueue = ['idle'];
        self.focused = ko.observable(false);
        self.activeSuggestions = ko.observableArray();
        self.activeSuggestion = ko.observable(-1);

        self.insertTag = function (tag) {
            var mode = tag.indexOf('+') != -1 ? 'scan' : 'rowkey';
            var tag = { value: tag, tag: mode } //parse mode
            self.tags.push(tag);
        }

        self.render = function (input, renderers) {
            var keys = Object.keys(renderers);
            for (var i = 0; i < keys.length; i++) {
                input = input.replace(renderers[keys[i]].select, function (selected) {
                    var hasMatched = false;
                    var processed = selected.replace(renderers[keys[i]].tag, function (tagged) {
                        hasMatched = true;
                        return "<span class='" + keys[i] + " tagsearchTag' title='" + keys[i] + "' data-toggle='tooltip'>" + ('nested' in renderers[keys[i]] ? self.render(tagged, renderers[keys[i]].nested) : tagged) + "</span>";
                    });
                    if (hasMatched && renderers[keys[i]]['strip'])
                        processed = processed.replace(renderers[keys[i]].strip, '');
                    return processed;
                });
            }
            return input;
        };

        self.updateMode = function (value) {
            self.submitted(false);
            var selection = value.slice(0, self.selectionEnd());
            var endindex = selection.slice(selection.lastIndexOf(',')).indexOf(',');
            if (endindex == -1) endindex = selection.length;
            var lastbit = value.substring(selection.lastIndexOf(','), endindex).trim();
            if (lastbit == "," || lastbit == "") {
                self.mode('idle');
                return;
            }
            var tokens = "[]+*{}";
            var m = 'rowkey';
            for (var i = selection.length - 1; i >= 0; i--) {
                if (tokens.indexOf(selection[i]) != -1) {
                    if (selection[i] == '{')
                        m = 'filter';
                    else if (selection[i] == '[')
                        m = 'columns';
                    else if (selection[i] == ']' || selection[i] == '}')
                        m = 'rowkey';
                    else if (selection[i] == '+')
                        m = 'scan';
                    else if (selection[i] == '-')
                        m = 'prefix';
                    break;
                }
            }
            self.mode(m.trim());
        };

        self.selectionStart = ko.observable(0);
        self.selectionEnd = ko.observable(0);

        self.hintText = ko.computed(function () {
            var pre, s, e;
            try {
                var r = window.getSelection().getRangeAt(0);
                pre = r.startContainer.nodeValue;
                s = r.startOffset;
                e = r.endOffset;
                return pre.slice(0, s) + "<span class='selection'>" + pre.slice(s, e) + "</span>" + pre.slice(e);
            } catch (e) {
                var value = self.cur_input();
                var selection = value.slice(0, self.selectionEnd());
                var index = selection.lastIndexOf(',') + 1;
                var endindex = value.slice(index).indexOf(',');
                endindex = endindex == -1 ? value.length : endindex;
                pre = value.substring(index, index + endindex);
                s = self.selectionStart() - index;
                e = self.selectionEnd() - index;
                if (s == e)
                    e += 1;
                s = s < 0 ? 0 : s;
                e = e > pre.length ? pre.length : e;
            }
            return pre.slice(0, s) + "<span class='selection'>" + pre.slice(s, e) + "</span>" + pre.slice(e);
        });

        self.onKeyDown = function (target, ev) {
            if (ev.keyCode == 13 && self.cur_input().slice(self.cur_input().lastIndexOf(',')).trim() != ",") {
                if (self.activeSuggestion() > -1) {
                    self.replaceFocusNode(self.activeSuggestions()[self.activeSuggestion()]);
                    self.activeSuggestion(-1);
                    setTimeout(function () {
                        var s = self.cur_input(), r;
                        if (s.lastIndexOf('(') != -1 && s.lastIndexOf(')') != -1) {
                            r = setCursor($('#search-tags')[0], s.lastIndexOf('(') + 1);
                            r.setEnd(r.endContainer, r.startOffset + (s.lastIndexOf(')') - s.lastIndexOf('(') - 1));
                        } else {
                            r = setCursor($('#search-tags')[0], s.length);
                        }
                        var sel = window.getSelection();
                        sel.removeAllRanges();
                        sel.addRange(r);
                    }, 1);
                } else {
                    self.evaluate();
                }
                return false;
            } else if (ev.keyCode == 219) {
                setTimeout(function () {
                    var ep = getEditablePosition($('#search-tags')[0], true);
                    self.cur_input(self.cur_input().slice(0, ep) + (ev.shiftKey ? '}' : ']') + self.cur_input().slice(ep));
                }, 1);
            } else if (ev.keyCode == 40) {
                if (self.activeSuggestion() < self.activeSuggestions().length - 1)
                    self.activeSuggestion(self.activeSuggestion() + 1);
                return false;
            } else if (ev.keyCode == 38) {
                if (self.activeSuggestion() > 0)
                    self.activeSuggestion(self.activeSuggestion() - 1);
                return false;
            }
            setTimeout(self.updateMenu, 1);
            return true;
        };

        self.updateMenu = function () {
            self.activeSuggestion(-1);
            try {
                var pos = getEditablePosition(document.getElementById('search-tags'));
                self.selectionStart(pos);
                self.selectionEnd(pos);
            } catch (err) {
            }
            self.updateMode(self.cur_input());
            self.updateSuggestions();
        };

        self.replaceFocusNode = function (text) {
            window.getSelection().getRangeAt(0).startContainer.nodeValue = text;
        };

        self.updateSuggestions = function () {
            var val = window.getSelection().getRangeAt(0).startContainer.nodeValue;
            switch (self.mode()) {
                case 'filter':
                    var focus = val.replace(/\{|\}|\s|&[^;]+?;/g, "").split(searchRenderers.rowkey.nested.filter.nested.linker.select).slice(-1)[0];
                    if (focus != "") {
                        self.activeSuggestions(self.filters.filter(function (a) {
                            return a.toLowerCase().replace(" ", "").indexOf(focus.toLowerCase()) != -1;
                        }));
                    } else {
                        self.activeSuggestions([]);
                    }
                    return;
                case 'rowkey':
                    var validate = window.getSelection().getRangeAt(0).startContainer.nodeValue;

                    function cancel() {
                        return window.getSelection().getRangeAt(0).startContainer.nodeValue != validate;
                    }

                    function callback() {
                        if (cancel()) return false;
                        if (validate.trim() != "") {
                            API.queryTable('getAutocompleteRows', 10, prepForTransport(validate.trim())).done(function (data) {
                                if (cancel()) return false;
                                self.activeSuggestions(data);
                            });
                        }
                    }

                    setTimeout(callback, 200);
                    return;
                default:
                    self.activeSuggestions([]);
                    return;
            }
        }

        self.evaluate = function () {
            table_search(self.cur_input());
            self.submitted(true);
            self.mode('idle');
        };

        $('#search-tags').blur(function () {
            self.focused(false);
        });

        self.doBlur = function () {
            if (self.cur_input().trim() == "") {
                function doClick() {
                    if (self.cur_input().trim() != "") return false;
                    setTimeout(function () {
                        $('#search-tags').focus();
                    }, 1);
                }

                $('#search-tags').html('<small>' + $('#search-tags').data("placeholder") + '</small>').one('click', doClick).find('small').on('mousedown', doClick);
            }
        }

        $('#search-tags').focus(function () {
            self.focused(true);
        });
    };

    var CellHistoryPage = function (options) {
        var self = this;

        self.items = ko.observableArray(options.items);
        self.loading = ko.observable(false);

        self.reload = function (timestamp, append) {
            if (!timestamp)
                timestamp = options.timestamp
            API.queryTable("getVerTs", prepForTransport(options.row), prepForTransport(options.column), timestamp, 10, 'null').done(function (res) {
                self.loading = ko.observable(true);
                if (!append)
                    self.items(res);
                else
                    self.items(self.items() + res);
                self.loading = ko.observable(false);
            });
        };

        self.pickHistory = function (data) {
            data.history = self;
            if (!ko.isObservable(data.value))
                data.value = ko.observable(data.value);
            launchModal('cell_edit_modal', { content: data, mime: detectMimeType(data.value()), readonly: true })
        };
    };


    var Router = {
        go: function (hBasePage) {
            if (!Views.render(hBasePage))
                return history.back();
            return hBasePage;
        },
        setTable: function (cluster, table) {
            Router.setCluster(cluster);
            app.pageTitle(cluster + ' / ' + table);
            app.views.tabledata.name(table);
            app.focusModel(app.views.tabledata);

            var bulkUploader = new qq.FileUploaderBasic({
                button: document.getElementById("bulk-upload-btn"),
                action: '/hbase/api/bulkUpload/"' + app.cluster() + '"/"' + app.views.tabledata.name() + '"',
                fileFieldLabel: 'hbase_file',
                multiple: false,
                onComplete: function (id, fileName, response) {
                    if (response.response != null)
                        huePubSub.publish('hue.global.error', { message: $(response.response).find('.alert strong').text() });
                    else
                        app.views.tabledata.reload();
                }
            });
        },
        setCluster: function (cluster) {
            app.cluster(cluster);
        }
    };

    var Views = {
        render: function (view) {
            var hBasePage = $('.hbase-page#hbase-page-' + view);
            if (!hBasePage)
                return false;
            $('.hbase-page.active').removeClass('active');
            hBasePage.addClass('active');
            return hBasePage;
        },
        displayError: function (error) {
            console.log(error);
        }
    };


    window.convertTimestamp = function (timestamp) {
        var date = new Date(parseInt(timestamp));
        return date.toLocaleString();
    }

    window.formatTimestamp = function (timestamp) {
        var date = new Date(parseInt(timestamp));
        return date.toUTCString();
    }


    var AppViewModel = function () {
        var self = this;

        self.station = ko.observable("");
        self.pageTitle = ko.observable("");
        self.focusModel = ko.observable();
        self.cluster = ko.observable("");
        self.cluster.subscribe(function () {
            app.views.tabledata.name('');
        });
        self.clusters = ko.observableArray();
        self.clusterNames = ko.computed(function () {
            return ko.utils.arrayMap(self.clusters(), function (cluster_config) {
                return cluster_config.name;
            });
        });
        self.search = new tagsearch();

        self.views = {
            tables: new DataTableViewModel({
                columns: ['Table Name', 'Enabled'], el: 'views.tables', reload: function (callback) {
                    var d_self = this;
                    d_self.isReLoading(true);
                    d_self.items.removeAll();
                    API.queryCluster("getTableList").done(function (data) {
                        d_self.items.removeAll(); //need to remove again before callback executes
                        function _isDropped(tableName) {
                            var _found = false;
                            d_self.droppedTables.forEach(function (t) {
                                if (t.name == tableName) {
                                    _found = true;
                                }
                            });
                            return _found;
                        }

                        var _items = [];
                        for (q = 0; q < data.length; q++) {
                            if (!_isDropped(data[q].name)) {
                                _items.push(new TableDataRow(data[q]));
                            }
                        }
                        d_self.droppedTables = [];
                        d_self.items(_items);
                        d_self._el.find('a[data-row-selector=true]').jHueRowSelector();
                        if (callback != null)
                            callback();
                        d_self.isReLoading(false);
                    });
                }
            }),
            tabledata: new SmartViewModel({
                'canWrite': canWrite, el: 'views.tabledata', reload: function (callback) //move inside SmartViewModel class?
                {
                    var t_self = this;

                    function getColumnFamilies() {
                        var cols = [];
                        var cfs = t_self.columnFamilies();
                        for (var i = 0; i < cfs.length; i++) {
                            if (cfs[i].enabled()) {
                                cols.push(cfs[i].name);
                            }
                        }
                        return cols;
                    }

                    API.queryTable("getRowQuerySet", JSON.stringify(getColumnFamilies()), ko.toJSON(t_self.querySet())).done(function (data) {
                        if (data.length > 0) {
                            var keys = Object.keys(data);
                            var items = [];
                            for (var i = 0; i < keys.length; i++) {
                                var row = new SmartViewDataRow({
                                    'canWrite': canWrite, items: [], row: data[keys[i]].row, reload: function (options) {
                                        var self = this;
                                        options = (options == null) ? {} : options;
                                        options = ko.utils.extend({
                                            callback: function (data) {
                                            },
                                            columns: getColumnFamilies()
                                        }, options);
                                        API.queryTable("getRow", JSON.stringify(options.columns), prepForTransport(self.row)).done(function (data) {
                                            self.setItems(data.columns);
                                            callback(data);
                                            self.isLoading(false);
                                        });
                                    }
                                });
                                row.setItems(data[keys[i]].columns);
                                items.push(row);
                            }
                            t_self.items(items);
                        }
                        if (typeof (callback) === 'function')
                            callback();
                        $('*[data-toggle="tooltip"]').tooltip();
                    });
                }
            })
        };

        self.initialize = function () {
            return API.query('getClusters').done(function (data) {
                app.clusters(data);
            });
        };


        self.showFullEditor = function (cellContent) {
            var currentValue = ko.isObservable(cellContent.value) ? cellContent.value() : cellContent.value;
            launchModal('cell_edit_modal', {
                originalValue: currentValue,
                currentValue: ko.observable(currentValue),
                value: ko.observable(currentValue),
                showingCurrent: ko.observable(true),
                readOnly: ko.observable(false),
                timestamp: ko.observable(cellContent.timestamp),
                content: cellContent,
                mime: ko.observable(detectMimeType(currentValue)),

                updateAce: function () {
                    if (this.ace) {
                        this.ace.setValue(this.value(), -1);
                    }
                },

                switchToHistorical: function (item) {
                    if (this.showingCurrent()) {
                        this.currentValue(this.value());
                    }
                    this.value(item.value);
                    this.mime(detectMimeType(this.value()));
                    this.updateAce();
                    this.showingCurrent(false);
                    this.timestamp(item.timestamp);
                },

                switchToCurrent: function () {
                    if (!this.showingCurrent()) {
                        this.value(this.currentValue());
                        this.mime(detectMimeType(this.value()));
                        this.showingCurrent(true);
                        this.timestamp(this.content.timestamp);
                        this.updateAce();
                    }
                }
            });
        }

        self.editCell = function ($data) {
            if ($data.value().length > 146) {
                self.showFullEditor($data);
            } else {
                $data.editing(true);
            }
        }


        self.hashToArray = function (hash) {
            var keys = Object.keys(hash);
            var output = [];
            for (var i = 0; i < keys.length; i++) {
                output.push({ 'key': keys[i], 'value': hash[keys[i]] });
            }
            return output;
        }

        self.stringHashColor = function (str) {
            var r = 0, g = 0, b = 0, a = 0;
            for (var i = 0; i < str.length; i++) {
                var c = str.charCodeAt(i);
                a += c;
                r += Math.floor(Math.abs(Math.sin(c)) * a);
                g += Math.floor(Math.abs(Math.cos(c)) * a);
                b += Math.floor(Math.abs(Math.tan(c)) * a);
            }
            return 'rgb(' + (r % 190) + ',' + (g % 190) + ',' + (b % 190) + ')'; //always keep values under 180, to keep it darker
        }

        self.lockClickOrigin = function (func, origin) {
            return function (target, ev) {
                if (origin != ev.target)
                    return function () {
                    };
                return func(target, ev);
            };
        }
    };


    var app = new AppViewModel();

    window.hbaseApp = app;


    ko.applyBindings(app, $('#hbaseComponents')[0]);


    //routing

    routed = false;
    app.initialize().done(function () {
        routie({
            ':cluster/:table/query': function (cluster, table) {
                routie(cluster + '/' + table);
            },
            ':cluster/:table/query/:query': function (cluster, table, query) {
                hueAnalytics.log('hbase', 'query_table');
                hueUtils.hueLocalStorage('hbase_cluster', cluster);
                app.station('table');
                app.search.cur_input(query);
                Router.setTable(cluster, table);
                resetElements();
                Views.render('dataview');
                app.views.tabledata._reloadcfs(function () {
                    app.search.evaluate();
                    app.views.tabledata.searchQuery(query);
                });
                routed = true;
            },
            ':cluster/:table': function (cluster, table) {
                hueAnalytics.log('hbase', 'view_table');
                hueUtils.hueLocalStorage('hbase_cluster', cluster);
                Router.setTable(cluster, table);
                resetSearch();
                resetElements();
                app.station('table');
                Views.render('dataview');
                routed = true;
            },
            ':cluster': function (cluster) {
                if ($.inArray(cluster, app.clusterNames()) == -1) {
                    routie('');
                } else {
                    hueAnalytics.log('hbase', 'view_cluster');
                    hueUtils.hueLocalStorage('hbase_cluster', cluster);
                    app.station('cluster');
                    app.cluster(cluster);
                    app.pageTitle(cluster);
                    Views.render('clusterview');
                    resetSearch();
                    resetElements();
                    app.views.tabledata.name('');
                    app.views.tables.reload();
                    routed = true;
                }
                resetElements();
                routed = true;
            },
            'error': function () {
                hueAnalytics.log('hbase', 'error');
                routed = true;
            },
            '': function () {
                var cluster = hueUtils.hueLocalStorage('hbase_cluster');
                if (cluster != null && $.inArray(cluster, app.clusterNames()) > -1) {
                    routie(cluster);
                } else {
                    routie(app.clusterNames()[0]);
                }
                resetElements();
                routed = true;
            },
            '*': function () {
                hueAnalytics.log('hbase', '');
                if (!routed)
                    history.back();
                routed = false;
            }
        });
        huePubSub.publish('hbase.app.loaded');
    });


    $.fn.renderElement = function (data) {
        utils.renderElement($(this, data))
    };

    $.fn.showIndicator = function () {
        $(this).addClass('isLoading');
    }

    $.fn.hideIndicator = function () {
        $(this).removeClass('isLoading');
    }

    $.fn.toggleIndicator = function () {
        $(this).toggleClass('isLoading');
    }

    function bindSubmit() {
        var self = this;
        var data = [];
        var hash_cache = {};
        if ($(this).attr("id") == "new_table_modal") {
            var _cols = [];
            $(this).find(".columns li.column").each(function (cnt, column) {
                var _props = {
                    name: $(column).find("input[name='table_columns']").val()
                };
                $(column).find(".columnProperties li").each(function (icnt, property) {
                    if (!$(property).hasClass("columnPropertyEmpty")) {
                        _props[$(property).find("select").val()] = $(property).find("input[name='table_columns_property_value']").val();
                    }
                });
                _cols.push({
                    properties: _props
                });
            });
            data = [
                $(this).find("input[name='cluster']").val(),
                $(this).find("input[name='tableName']").val(),
                JSON.stringify(_cols)
            ]
        }
        else {
            $(this).find('.controls > input, .controls > textarea, .controls > ul input').not('input[type=submit]').each(function () {
                if ($(this).hasClass('ignore'))
                    return;
                var use_post = $(this).data('use-post');
                var submitVal = null;
                if ($(this).data('subscribe')) {
                    var target = $($(this).data('subscribe'));
                    switch (target[0].tagName) {
                        case "UL":
                            var serialized = {};
                            target.find('li').each(function () {
                                serialized[$(this).find('input')[0].value] = $(this).find('input')[1].value;
                            });
                            submitVal = serialized;
                            use_post = true;
                            break;
                    }
                }
                else if ($(this).hasClass('serializeHash')) {
                    var target = $(this).attr('name');
                    if (!hash_cache[target])
                        hash_cache[target] = {};
                    hash_cache[target][$(this).data(key)] = $(this).val();
                }
                else {
                    submitVal = $(this).val();
                    //change reload next
                }
                if (submitVal) {
                    if (use_post) {
                        submitVal = "hbase-post-key-" + JSON.stringify(submitVal);
                    } else {
                        submitVal = prepForTransport(submitVal);
                    }
                    data.push(submitVal);
                }
            });
        }

        $(this).find('input[type=submit]').addClass('disabled').showIndicator();
        var ui = app.focusModel();
        if (ui)
            ui.isLoading(true);

        API.queryArray($(this).attr('action'), data).always(function () {
            $(self).find('input[type=submit]').removeClass('disabled').hideIndicator();
            if (ui)
                ui.isLoading(false);
        }).done(function () {
            $(self).modal('hide');
            if (ui)
                app.focusModel().reload();
        });

        return false;
    }

    $('form.ajaxSubmit').submit(bindSubmit).on('hidden', function () {
        $(this).trigger('reset');
    });

    huePubSub.subscribe('hbase.prepare.new.form', function () {
        $("#new_table_modal .modal-body ul").empty();
        addColumnToNewTableForm();
    }, 'hbase');

    var addColumnToNewTableForm = function () {
        var $li = $("<li>").addClass("column").css("marginBottom", "10px").html($("#columnTemplate").html());
        $li.find("ul").html($("#columnPropertyEmptyTemplate").html());
        $li.appendTo($("#new_table_modal .modal-body ul.columns"));
    }

    var addColumnPropertyToColumn = function (col) {
        var $li = $("<li>").addClass("columnProperty").css("marginBottom", "5px").html($("#columnPropertyTemplate").html());
        $li.find("select").on("change", function () {
            $li.find("[name='table_columns_property_value']").attr("placeholder", $(this).find("option:selected").data("default"));
        });
        $li.appendTo(col.find("ul"));
    }

    $(document).on("click", "a.action_addColumn", function () {
        addColumnToNewTableForm();
    });


    $(document).on("click", "a.action_removeColumn", function () {
        $(this).parents("li").remove();
    });

    $(document).on("click", "a.action_addColumnProperty", function () {
        addColumnPropertyToColumn($(this).parents(".column"));
        $(this).parents(".column").find(".columnPropertyEmpty").remove();
    });

    $(document).on("click", "a.action_removeColumnProperty", function () {
        var _col = $(this).parents(".column");
        _col.find(".columnPropertyEmpty").remove();
        $(this).parent().remove();
        if (_col.find("li").length == 0) {
            _col.find("ul").html($("#columnPropertyEmptyTemplate").html());
        }
    });

});