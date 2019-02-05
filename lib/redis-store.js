const CacheStore = require('./cache-store');
const redis = require('redis');
const { promisify } = require('util');
const defaults = require('defaults-es6');

module.exports = class RedisStore extends CacheStore {

    constructor(opts={}) {
        opts = defaults(opts, {
            redisImplementation: redis
        })
        super();
        this.client = opts.redisImplementation.createClient(opts);
        this.client.on('error', err => {
            console.error(err);
            this.failed = true;
        })
    }

    async has(key) {
        return promisify(this.client.exists).bind(this.client)(key);
    }

    async getMetadata(key) {
        var val = await promisify(this.client.get).bind(this.client)(`${key}_meta`);
        return JSON.parse(val);
    }

    async setMetadata(key, value) {
        return promisify(this.client.set).bind(this.client)(`${key}_meta`, JSON.stringify(value));
    }

    async mset() {
        var args = Array.from(arguments);
        var timestamps = args.length % 2 ? args.splice(-1, 1)[0] : null;

        await promisify(this.client.mset).bind(this.client)(
            ...args.map((arg, ii) => ii % 2 ? JSON.stringify(arg) : arg), 
            ...args.map((arg, ii) => ii % 2 ? JSON.stringify({ setTime: timestamps[Math.floor(ii / 2)] }) : `${arg}_meta`)
        )
    }

    async mget() {
        var keys = Array.from(arguments);
        var vals = await promisify(this.client.mget).bind(this.client)(...keys);

        return vals.map(val => JSON.parse(val));
    }

    async del() {
        var keys = Array.from(arguments);
        var timestamps = Array.isArray(keys[keys.length - 1]) ? keys.splice(-1, 1)[0] : null;
        return Promise.all([
            promisify(this.client.del).bind(this.client)(keys),
            timestamps ? promisify(this.client.mset).apply(this.client, keys.reduce((acc, key, ii) => acc.concat([`${key}_meta`, JSON.stringify({ setTime: timestamps[ii] })]), [])) : Promise.resolve()
        ])
    }

    async set(key, value, timestamp) {
        return Promise.all([
            promisify(this.client.set).bind(this.client)(key, JSON.stringify(value)),
            this.setMetadata(key, {setTime: timestamp})
        ])
        .then(() => value)
    }

    async get(key) {
        var val = await promisify(this.client.get).bind(this.client)(key);
        return JSON.parse(val);
    }

    async keys(pattern='*') {
        var keys = await promisify(this.client.keys).bind(this.client)(pattern);

        return keys.filter(key => key.slice(-5) !== '_meta' && keys.includes(key + '_meta'))
    }

    async values() {
        var keys = await promisify(this.client.keys).bind(this.client)('*');
        
        if (!keys.length) {
            return [];
        }
        
        return this.mget(...keys)
            .then(async vals => {
                var badKeys = vals
                    .map((obj, ii) => !(obj && ((obj && 'e' in obj && 'v' in obj && 'k' in obj) || (obj && 'setTime' in obj))) ? ii : null)
                    .filter(val => val != null)
                    .map(badIndex => keys[badIndex]);
                await this.del.apply(this, badKeys)
                return vals.filter(obj => (obj && 'e' in obj && 'v' in obj && 'k' in obj))
            })
    }
}