const { crc32 } = require('crc');

/**
 * @typedef TimestampMs A number of milliseconds since the Unix epoch.
 */

 /**
  * Cache store interface class. Defines IO and utility methods.
  * 
  * @interface
  */

module.exports = class CacheStore {

    /**
     * Constructs a cache store.
     * 
     * @property
     */
    constructor() {
        this.failed = false;
        /**
         * Object of keys to promises, indicating that a write operation (del or set) is currently in-progress for the associated key.
         * @type {Object}
         * @private
         */
        this.writePromises = {};
        /**
         * Object of keys to boolean, indicating the last known state of the key's write state.
         * @type {Object}
         * @private
         */
        this.hasValues = {};
        /**
         * Object of keys to arrays of functions. This queue is processed in sequence, the progress of which is reflected in the writePromises member.
         * @type {Object}
         * @private
         */
        this.writeQueues = {};
    }

    async queueWrite(key, func) {
        if (this.writePromises[key]) {
            if (!(key in this.writeQueues)) {
                this.writeQueues[key] = [];
            }
            this.writeQueues[key].push(func)
            return this.writePromises[key];
        } else {
            return this.writePromises[key] = Promise.resolve()
                .then(func)
                .then(writeResult => {
                    if (this.writeQueues[key] && this.writeQueues[key].length) {
                        return this.queueWrite(key, this.writeQueues.splice(0, 1)[0])
                    } else {
                        this.writePromises[key] = null;
                        return this.hasValues[key] = writeResult
                    }                    
                })
        }
    }   

    /**
     * Converts a key into a shortened, path-friendly hash.
     * 
     * @param {String} key 
     * 
     * @returns {String}
     */

    static hashKey(key) {
        return crc32(key).toString(16);
    }

    /**
     * @abstract
     */

    async mget() {}
    /**
     * @abstract
     */

    async has(key) {}
    /**
     * @abstract
     */
    async set(key, value) {}
    /**
     * @abstract
     */
    async mset() {}
    /**
     * @abstract
     */
    async get(key) {}
    /**
     * @abstract
     */
    async mdel() {}
    /**
     * @abstract
     */
    async del() {}
    /**
     * @abstract
     */
    async values() {}
    /**
     * @abstract
     */
    async keys() {}
    /**
     * @abstract
     */
    async getMetadata(key) {}
    /**
     * @abstract
     */
    async setMetadata(key) {}

    /**
     * @param {String} key Key to check
     * @param {TimestampMs} [setTime=null] Time that this key was set locally. Used as comparison against remote timestamp. 
     * 
     * @returns {Promise<boolean|null>} A boolean result tells whether or not the remote state has changed. Null result indicates that the remote does not contain the key.
     */

    async checkIfHasNewer(key, setTime=null) {
        var metadata = await this.getMetadata(key);
        
        if (!metadata) {
            return null;
        }
        if (metadata && (!setTime || metadata.setTime > setTime)) {
            return true;
        }
        return false;
    }

}