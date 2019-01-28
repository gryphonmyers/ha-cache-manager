const Lru = require('lru-cache');
const deepEqual = require('deep-equal');
const EventEmitter = require('events').EventEmitter;
const defaults = require('defaults-es6');

const DELETED_VALUE = Symbol('DELETED_VALUE');

module.exports = class Cache extends EventEmitter {
    static get defaultOpts() {
        return {
            max: 300000,
            stores: [],
            returnStaleWhileRefreshing: true,
            isCacheableValue: val => val != null
        }
    }

    init() {
        return this.load()
    }
    
    constructor(opts={}) {
        super();
        opts = defaults(opts, this.constructor.defaultOpts);
        this.lru = new Lru(defaults({
            // noDisposeOnSet: true,
            max: opts.max,
            length: function(val) {
                var length = JSON.stringify(val).length;
                return length;
            },
            dispose: (key, val) => {
                this.lastGoodValues[key] = val;
            },
            maxAge: !isNaN(opts.ttl) ? opts.ttl * 1000 : null
        }, opts));
        this.ttlFunc = typeof opts.ttl === 'function' ? opts.ttl : null;
        // this.streams = {};
        this.stores = opts.stores;
        this.lastGoodValues = {};
        this.setTimes = {};
        this.isCacheableValue = opts.isCacheableValue;
        this.returnStaleWhileRefreshing = opts.returnStaleWhileRefreshing;
        this.dumpPromise = null;
        this.changedKeys = [];
        this.wrapPromises = {};
        this.refreshPromises = {};
        this.primaryStore = this.stores.find(store => store.isPrimary);

        this.on('valuechange', evt => {
            var keys = evt.key;
            if (!Array.isArray(keys)) {
                keys = [keys];
            }
            keys.forEach(key => {
                this.setTimes[key] = evt.timestamp;
            })
            if (!this.dumpPromise) {
                this.dumpPromise = this.dump(evt.key);
            } else {
                this.changedKeys = this.changedKeys.concat(evt.key)
                    .reduce((acc, curr) => acc.includes(curr) ? acc : acc.concat(curr), []);
            }
        })
    }

    load(values) {
        if (values) {
            this.lru.load(values)
            return Promise.resolve();
        }
        var primaryStore = this.stores.find(val => val.isPrimary) || this.stores[0];
        return (primaryStore ? primaryStore.values()
            .then(data => {
                this.lru.load(data);
            }) : Promise.resolve())            
    }

    dump(keys) {
        if (!keys) throw new Error('Cache dump requires key');

        if (!Array.isArray(keys)) {
            keys = [keys];
        }
        var dump = this.lru.dump();
        var values = keys.map(key => dump.find(dumpVal => dumpVal.k === key) || DELETED_VALUE);
        var timestamps = keys.map(key => this.setTimes[key]);
        var [ pairs, delKeys ] = keys.reduce((acc, curr, ii) => values[ii] === DELETED_VALUE ? [ acc[0], [...acc[1], curr ] ] : [ [...acc[0], curr, values[ii]], acc[1]], [[], []]);

        return Promise.all(this.stores.map(coldStore => 
            Promise.all([
                coldStore.mset(...pairs, timestamps),
                coldStore.mdel(...delKeys, timestamps),
            ])
        ))
        .then(() => {
            var keys = this.changedKeys
            if (keys.length) {
                this.changedKeys = [];
                return this.dump(keys);
            } else {
                this.dumpPromise = null;
            }
        })
    }

    stream(key, stream) {
        /* @TODO add api for streaming values from cache or wrapped function */
    }

    async wrap(key, fetcher, opts={}) {
        opts = defaults(opts, { returnStaleWhileRefreshing: this.returnStaleWhileRefreshing });

        var cacheValue = await this.get(key);

        if (cacheValue != null) {
            return Promise.resolve(cacheValue);
        }

        var lastGoodValue = this.lastGoodValues[key];

        var promise = Promise.resolve();

        if (this.refreshPromises[key]) {
            promise = this.refreshPromises[key]
                .then(async () => {
                    var val = await this.get(key)
                    return val
                });
        }

        promise = promise.then(val => {
            if (val == null) {
                return this.wrapPromises[key] || (this.wrapPromises[key] = Promise.resolve(fetcher(lastGoodValue))
                    .then(async val => {
                        // if (val instanceof require('stream').Readable) {
                        //     // maybe here save streams into a special place where they can be read from immediately, then ultimately save their end values into cache
                        // }
                        return this.set(key, val, opts.ttl)
                            .then(val => {
                                delete this.wrapPromises[key];
                                return val;
                            })
                    })
                    .catch(err => {
                        console.error(`Error in cache wrap function for key: ${key}. Returning stale value, if one exists.`, err);
                        delete this.wrapPromises[key];
                        return lastGoodValue || null;
                    })
                )
            }
            return val;
        })

        if (lastGoodValue && opts.returnStaleWhileRefreshing) {
            return Promise.resolve(lastGoodValue);
        }

        return promise
    }

    async refreshFromStore(store, key) {
        return this.refreshPromises[key] || (this.refreshPromises[key] = store.checkIfHasNewer(key, this.setTimes[key])
            .then(async hasNewer => {

                if (hasNewer) {
                    var val = await store.get(key);
                    
                    await this.set(val);
                }
                this.refreshPromises[key] = null;
                
                return hasNewer
            })
        )
    }

    async set(key, val, ttl=null) {
        if (key && typeof key === 'object' && ('k' in key && 'v' in key)) {
            var serializedVal = key;
            key = serializedVal.k;
        } else if (ttl == null && this.ttlFunc) {
            ttl = this.ttlFunc(key, val) * 1000
        }

        var oldVal = this.lru.peek(key);
        oldVal = oldVal == null ? this.lastGoodValues[key] : oldVal;
        var isCacheableValue = this.isCacheableValue(val);

        if (serializedVal) {
            var dumped = this.lru.dump().filter(item => item.k === key).concat(serializedVal);
            this.lru.load(dumped);
            val = this.lru.peek(key);
        } else {
            if (isCacheableValue) {
                delete this.lastGoodValues[key];
            
                this.lru.set(key, val, ttl);
            }
        }

        if (isCacheableValue && !deepEqual(val, oldVal)) {
            this.emit('valuechange', {key, val, timestamp: Date.now(), oldVal});
        }

        return val;
    }

    async get(key) {
        if (this.primaryStore) {
            var refreshPromise = this.refreshFromStore(this.primaryStore, key)
                .then(didRefresh => {
                    return this.lru.get(key);
                })
            if (!this.returnStaleWhileRefreshing) {
                return refreshPromise;
            }
        }

        return this.lru.get(key);
    }

    async del(key) {
        var oldVal = this.lru.peek(key);

        this.lru.del.apply(this.lru, arguments);

        if (oldVal) {
            this.emit('valuechange', {key, val: DELETED_VALUE, timestamp: Date.now(), oldVal});
        }
    }

    async reset() {
        var key = this.lru.keys();
        var oldVal = this.lru.values();
        this.lru.reset();
        this.emit('valuechange', {key, val: oldVal.map(() => DELETED_VALUE), timestamp: Date.now(), oldVal })
    }
}