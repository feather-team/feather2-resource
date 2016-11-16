var _ = require('underscore');

_.extend = function(source, sup){
    if(Array.isArray(sup)){
        source = source || [];
        source.push.apply(source, sup);
        return source;
    }else if(typeof sup == 'object'){
        _.each(sup, function(item, key){
            source[key] = _.extend(source[key], item);
        })

        return source;
    }else{
        return sup;
    }
};

function Resource(maps, options){
    this.maps = maps || {};
    this.options = options || {};
    this.urlCache = {};
}

Resource.CONCATS_TYPE = ['headJs', 'bottomJs', 'css', 'asyncs', 'deps'];
Resource.RESOURCES_TYPE = ['headJs', 'bottomJs', 'css'];
Resource.FEATHER_LOADER = 'static/feather.js';

Resource.prototype.getMapInfo = function(id){
    var self = this;
    var map = self.maps[id] || {}, refsMap = {};

    (map.refs || []).forEach(function(ref){
        var usefulMap = {};

        _.each(self.getMapInfo(ref), function(refMap, type){ 
            if(Resource.CONCATS_TYPE.indexOf(type) > -1){
                usefulMap[type] = refMap;
            }
        });

        _.extend(refsMap, usefulMap);
    });

    return _.extend(refsMap, map);
};

Resource.prototype.getUrls = function(resources, returnHash, includeNotFound, founds, pkgFounds){
    var self = this;
    var urls = [], founds = founds || {}, pkgFounds = pkgFounds || {};

    resources.forEach(function(resource){
        var info = self.maps[resource], url = founds[resource];

        if(info){
            if(!url){
                var pkgInfo, pkgName = info.pkg;

                if(pkgName){
                    url = pkgFounds[pkgName];

                    if(!url){
                        pkgInfo = self.maps[pkgName];
                        url = pkgFounds[pkgName] = pkgInfo.url;
                        self.urlCache[url] = pkgInfo;
                    }
                }else{
                    url = info.url;
                    self.urlCache[url] = info;
                }

                self.urlCache[url].id = resource;

                founds[resource] = url;

                if(info.deps){
                    urls = _.extend(self.getUrls(info.deps, false, includeNotFound, founds, pkgFounds), urls);
                }

                if(info.asyncs){
                    urls = _.extend(self.getUrls(info.asyncs, false, includeNotFound, founds, pkgFounds), urls);
                }

                if(pkgInfo && pkgInfo.useJsWraper){
                    var noWraperHas = pkgInfo.has.filter(function(has){
                        return founds[has];
                    });

                    if(noWraperHas.length){
                        urls = _.extend(self.getUrls(noWraperHas, false, includeNotFound, founds, pkgFounds), urls);
                    }
                }
            }
        }else{
            url = resource;

            if(includeNotFound){
                founds[resource] = resource;
            }   
        }

        urls.push(url);
    });

    return returnHash ? founds : _.uniq(urls);
};

Resource.prototype.getThreeUrls = function(mapInfo){
    var self = this;
    var inJsCss = [], allUrls = {};

    Resource.RESOURCES_TYPE.forEach(function(type){
        var urls = self.getUrls(mapInfo[type] || [], false, true);

        if(type != 'css'){
            for(var i = 0; i < urls.length; i++){
                var url = urls[i];

                if(self.urlCache[url] && self.urlCache[url].type == 'css'){
                    inJsCss.push(url);
                    urls.splice(i--, 1);
                }
            }
        }

        allUrls[type] = urls;
    });

    _.extend(allUrls.css, inJsCss);

    var comboOptions = this.options.combo;

    _.each(allUrls, function(urls, type){
        urls = allUrls[type] = _.uniq(urls);

        if(!comboOptions) return;

        var combos = [], i = 0;

        urls.forEach(function(url){
            var info = self.urlCache[url];

            if(info){
                if((comboOptions.onlyUnPackFile && !info.isPkg || !comboOptions.onlyUnPackFile) 
                    && !/(?:^|:)static\/(?:.+?\/)*third\//.test(info.id)
                ){
                    if(!combos[i]){
                        combos[i] = [url];
                    }else{
                        combos[i].push(url);
                    }
                }else{
                    combos.push(url);
                    i = combos.length;
                }
            }else{
                combos.push(url);
                i = combos.length;
            }
        });

        var finalUrls = [];

        combos.forEach(function(urls){
            if(typeof urls == 'string'){
                finalUrls.push(urls);
                return;
            }else if(urls.length == 1){
                finalUrls.push(urls[0]);
                return;
            }

            var dir, len = 0, dirLen, bases = [];

            urls.forEach(function(url){
                var matches = url.match(/^(?:(?:https?:)?\/\/[^\/]+)?\//);
                var domain = matches[0];

                if(!dir){
                    dir = domain;
                }

                if(domain != dir || len >= comboOptions.maxUrlLength){
                    if(bases.length > 1){
                        finalUrls.push(dir + comboOptions.syntax[0] + bases.join(comboOptions.syntax[1]));
                    }else if(bases.length == 1){
                        finalUrls.push(bases[0]);
                    }

                    bases.length = 0;
                    dir = domain;
                }

                dirLen = domain.length;

                var base = url.substr(dirLen);
                bases.push(base);
                len += base.length;
            });

            if(bases.length > 1){
                finalUrls.push(dir + comboOptions.syntax[0] + bases.join(comboOptions.syntax[1]));
            }else if(bases.length == 1){
                finalUrls.push(dir + bases[0]);
            }   
        });


        allUrls[type] = finalUrls;
    });

    return allUrls;
};

Resource.prototype.getRequireInfo = function(mapInfo){
    var self = this;
    var infos = this.getUrls(mapInfo.asyncs || [], true), maps = {}, deps = {};

    _.each(infos, function(url, id){
        if(!maps[url]){
            maps[url] = [];
        }

        maps[url].push(id);

        var info = self.maps[id];

        if(info.deps){
            deps[id] = info.deps;
        }
    });

    _.each(maps, function(ids, pkg){
        maps[pkg] = _.uniq(ids);
    });

    return {
        deps: deps,
        map: maps
    };
};

Resource.prototype.getResourceInfo = function(id){
    var mapInfo = this.getMapInfo(id), isPagelet = mapInfo.isPagelet;
    var pageletAsyncs = [];

    if(isPagelet){
        Resource.RESOURCES_TYPE.forEach(function(type){
            if(mapInfo[type]){
                pageletAsyncs = pageletAsyncs.concat(mapInfo[type]);
                mapInfo[type] = [];
            }
        });

        mapInfo.asyncs = (mapInfo.asyncs || []).concat(pageletAsyncs);
    }

    if(mapInfo.asyncs && !isPagelet){
        if(mapInfo.headJs){
            mapInfo.headJs.unshift(Resource.FEATHER_LOADER);
        }else{
            mapInfo.headJs = [Resource.FEATHER_LOADER];
        }    
    }

    var result = {
        threeUrls: this.getThreeUrls(mapInfo),
        requires: this.getRequireInfo(mapInfo)
    };

    if(isPagelet){
        result.pageletAsyncs = pageletAsyncs;
    }

    return result;
};

module.exports = Resource;