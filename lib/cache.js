const Lru = require('lru-cache');
const deepEqual = require('deep-equal');
const { EventEmitter } = require('events');
const defaults = require('defaults-es6');
const { Stream } = require('stream');

const DELETED_VALUE = Symbol('DELETED_VALUE');
const REMOTE_DELETED = Symbol('REMOTE_DELETED');
const REMOTE_CHANGED =  Symbol('REMOTE_CHANGED');
const REMOTE_UNCHANGED = Symbol('REMOTE_UNCHANGED');
const REMOTE_MISSING = Symbol('REMOTE_MISSING');

module.exports = class Cache extends EventEmitter {
    static get defaultOpts() {
        return {
            max: 100000000,
            backupMax: 50000000,
            backupStores: [],
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
        var length = function(val) {
            if (!val) {
                return 0;
            }
            if (val instanceof Stream) {
                return val.getLength();
            }
            return Buffer.byteLength(JSON.stringify(val), 'utf8');
        };
        this.backupLru = new Lru({
            max: opts.backupMax,
            length
        });
        this.lru = new Lru(defaults({
            // noDisposeOnSet: true,
            max: opts.max,
            length,
            dispose: (key, val) => {
                this.backupLru.set(key, val);
            },
            maxAge: !isNaN(opts.ttl) ? opts.ttl * 1000 : null
        }, opts));
        this.ttlFunc = typeof opts.ttl === 'function' ? opts.ttl : null;
        // this.streams = {};
        this.store = opts.store;
        this.backupStores = opts.backupStores;
        this.setTimes = {};
        this.isCacheableValue = opts.isCacheableValue;
        this.returnStaleWhileRefreshing = opts.returnStaleWhileRefreshing;
        this.dumpPromise = null;
        this.changedKeys = [];
        this.wrapPromises = {};
        this.refreshPromises = {};
        this.diffPromises = {};

        this.on('valuechange', evt => {
            var keys = evt.key;

            if (!Array.isArray(keys)) {
                keys = [keys];
            }
            keys.forEach(key => {
                this.setTimes[key] = evt.timestamp;
            })
            if (!this.dumpPromise) {
                this.dumpPromise = this.dump(keys);
            } else {
                this.changedKeys = this.changedKeys.concat(evt.key)
                    .reduce((acc, curr) => acc.includes(curr) ? acc : acc.concat(curr), []);
            }
        })
    }

    get stores() {
        return this.store ? [this.store, ...this.backupStores] : this.backupStores;
    }

    load(values) {
        if (values) {
            this.lru.load(values)
            return Promise.resolve();
        }
        return (this.store ? this.store.values()
            .then(data => {
                data = data.filter(val => val)
                this.lru.load(data);
                var results = this.lru.dump();
                return data.map(item => {
                    if (!item || !results.find(result => result.key === item.key)) {
                        return this.store.del(item.k);
                    }
                    return Promise.resolve();
                })
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

        return Promise.all(this.stores.map(store => 
            Promise.all([
                pairs.length ? store.mset(...pairs, timestamps) : Promise.resolve(),
                delKeys.length ? store.del(...delKeys, timestamps) : Promise.resolve(),
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

        var remoteState = this.store ? await this.dedupedDiffStoreState(this.store, key) : null;
        var cacheValue = await this.get(key, remoteState);
        
        if (cacheValue != null && ![REMOTE_DELETED].includes(remoteState)) {
            return Promise.resolve(cacheValue);
        }

        var lastGoodValue = this.backupLru.get(key);

        var promise = (this.refreshPromises[key] || Promise.resolve(null)).then(val => {
            if (val == null) {
                return this.wrapPromises[key] || (this.wrapPromises[key] = Promise.resolve(fetcher(lastGoodValue))
                    .then(async val => {
                        return this.set(key, val, opts.ttl)
                            .then(val => {
                                delete this.wrapPromises[key];
                                return val;
                            })
                    })
                    .catch(err => {
                        console.error(`Error in cache wrap function for key: ${key}. Returning stale value, if one exists.`, err);
                        delete this.wrapPromises[key];
                        if (lastGoodValue) {
                            this.emit('caughterror', err);
                            return lastGoodValue;
                        }
                        throw err;
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

    /**
     * 
     * @param {string} key 
     * @param {*} val 
     * @param {Number} [ttl] 
     */

    async set(key, val, ttl=null) {
        if (ttl == null && this.ttlFunc) {
            ttl = this.ttlFunc(key, val) * 1000
        } else if (ttl != null && !this.ttlFunc) {
            ttl = ttl * 1000;
        }

        if (this.store) {
            var remoteState = await this.dedupedDiffStoreState(this.store, key);
            await this.syncStoreKey(remoteState, this.store, key);
        }
        
        var oldVal = this.lru.peek(key);
        oldVal = oldVal == null ? this.backupLru.get(key) : oldVal;
        var isCacheableValue = this.isCacheableValue(val);

        if (isCacheableValue) {
            this.backupLru.del(key);
        
            this.lru.set(key, val, ttl);
        }

        if (isCacheableValue && !deepEqual(val, oldVal)) {
            this.emit('valuechange', {key, val, timestamp: Date.now(), oldVal});
        }

        return val;
    }

    setSerialized(serializedVal) {
        if (!serializedVal) {
            return null;
        }
        var key = serializedVal.k;
        var oldVal = this.lru.peek(key);
        oldVal = oldVal == null ? this.backupLru.get(key) : oldVal;
        var dumped = this.lru.dump().filter(item => item.k !== key).concat(serializedVal);

        this.lru.load(dumped);
        var val = this.lru.peek(key);
        var isCacheableValue = this.isCacheableValue(val);

        if (isCacheableValue && !deepEqual(val, oldVal)) {
            this.emit('valuechange', {key, val, timestamp: Date.now(), oldVal});
        }
        return val;
    }

    async diffStoreState(store, key) {
        var hasNewer = await store.checkIfHasNewer(key, this.setTimes[key]);
        if (hasNewer == null) {
            return REMOTE_MISSING;
        }
        var hasItem = await store.has(key);
        if (hasItem) {
            if (hasNewer) {
                return REMOTE_CHANGED;
            }
            return REMOTE_UNCHANGED;
        }
        return REMOTE_DELETED;
    }

    async dedupedDiffStoreState(store, key) {
        return (this.diffPromises[key] || (this.diffPromises[key] = this.diffStoreState(store, key))).then(remoteState => {
            this.diffPromises[key] = null;
            return remoteState;
        });
    }

    async get(key, remoteState = null) {
        if (this.store) {
            if (!remoteState) {
                remoteState = await this.dedupedDiffStoreState(this.store, key);
            }
            var syncPromise = this.syncStoreKey(remoteState, this.store, key);

            if (remoteState === REMOTE_DELETED || remoteState === REMOTE_CHANGED) {
                return syncPromise;
            } else if (!this.returnStaleWhileRefreshing) {
                await syncPromise;
            }
        }
        return this.lru.get(key);        
    }

    async syncStoreKey(remoteState, store, key) {
        //TODO could structure this a bit better, keeping these various promise queues in the respective store objects maybe
        switch (remoteState) {
            case REMOTE_DELETED:
                return (this.refreshPromises[key] = (this.refreshPromises[key] || Promise.resolve()).then(async () => {
                    await this.del(key);
                    this.refreshPromises[key] = null;
                    return null;
                }))
            case REMOTE_CHANGED:
                return (this.refreshPromises[key] = (this.refreshPromises[key] || Promise.resolve()).then(async () => {
                    var val = await store.get(key);
                    val = this.setSerialized(val);
                    this.refreshPromises[key] = null;
                    return val;
                }));
            case REMOTE_UNCHANGED:
                return Promise.resolve(this.lru.get(key));
            case REMOTE_MISSING:
                return Promise.resolve(null);
            default:
                throw new Error(`Unrecognized remote state: ${remoteState}`);
        }
    }

    async del(key) {
        if (arguments.length > 1) {
            var keys = Array.from(arguments);
        } else if (Array.isArray(key)) {
            keys = key;
        } else {
            keys = [key];
        }

        if (this.store) {
            var remoteStates = await Promise.all(keys.map(key => this.dedupedDiffStoreState(this.store, key)));
            
            await Promise.all(remoteStates.map((remoteState, ii) => {
                var key = keys[ii];
                if (remoteState !== REMOTE_DELETED) {
                    return this.syncStoreKey(remoteState, this.store, key);
                }
            }))
        }

        var oldVals = keys
            .map(key => this.lru.peek(key));


        keys.forEach(key => {
            this.lru.del(key);
            this.backupLru.del(key);
        });

        var changedKeys = keys.filter((key, ii) => oldVals[ii] != null);

        if (changedKeys.length) {
            this.emit('valuechange', {key: changedKeys, val: changedKeys.map(() => DELETED_VALUE), timestamp: Date.now(), oldVal: oldVals.filter(oldVal => oldVal != null)});
        }

        return this.dumpPromise;
    }

    async keys(pattern) {
        return Promise.resolve(this.store ? this.store.keys(pattern) : this.lru.keys());
    }

    async values() {
        return Promise.resolve(this.store ? this.store.values() : this.lru.values());
    }

    async reset() {
        var keys = await this.keys();
        return this.del(keys);
    }
}