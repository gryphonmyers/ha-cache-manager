const mockFs = require('mock-fs');
const MockDate = require('mockdate');
const redisMock = require('redis-mock');
const tap = require('tap');
const fs = require('mz/fs');
const { promisify } = require('util');
const rimraf = require('rimraf-then');
const mkdirp = require('mkdirp-then');

const Cache = require('../');
const FileStore = require('../lib/file-store');
const RedisStore = require('../lib/redis-store');


/* todo test for backupLru */

tap.test('Test cache', async test =>  {
    var cache = new Cache({
    });

    await cache.init();

    var val = await cache.wrap('foo', function(){
        return 'bar';
    });

    test.equals(val, 'bar');
    cache.removeAllListeners();
})

tap.test('Test cache', async test =>  {
    var cache = new Cache({
    });

    await cache.init();

    var oldVal = await cache.wrap('foo', () => {
        return 'baz';
    })

    var val = await cache.wrap('foo', () => {
        return new Promise(resolve => {
            setTimeout(1000, () => resolve('bag'))
        });
    });

    test.equals(val, 'baz', 'Set cache has expected value');
    cache.removeAllListeners();
})

tap.test('Test cache set', async test =>  {
    var cache = new Cache({
    });

    await cache.load();

    var val = await cache.set('foo', 'bar');

    test.equals(val, 'bar');

    val = await cache.set('foo', 'brick');
    val = await cache.set('foo', 'brack');

    test.equals(val, 'brack');

    cache.set('foo', 'block');

    test.equals(val, 'brack', 'Cache set without awaiting promise returns old value.');
    cache.removeAllListeners();
})


tap.test('Test cache ttl', async test =>  {
    test.test('Test undefined ttl functionality', async test => {
        var cache = new Cache({
        });
    
        await cache.load();
    
        MockDate.set('2019-01-01T08:00');
    
        await cache.set('foo', 'bar');
    
        var val = await cache.get('foo');
    
        test.equals(val, 'bar');
    
        MockDate.set('2019-01-01T08:01');
    
        val = await cache.get('foo');
    
        test.equals(val, 'bar');
    
        MockDate.set('2019-02-01T08:02');
    
        val = await cache.get('foo');
    
        test.equals(val, 'bar', 'With undefined ttl, even a month later it still returns a set value.');

        MockDate.reset();
        cache.removeAllListeners();
    })

    test.test('Test basic ttl functionality', async test => {
        var cache = new Cache({
            ttl: 60
        });
    
        await cache.load();
    
        MockDate.set('2019-01-01T08:00');
    
        await cache.set('foo', 'bar');
    
        var val = await cache.get('foo');
    
        test.equals(val, 'bar');
    
        MockDate.set('2019-01-01T08:01');
    
        val = await cache.get('foo');
    
        test.equals(val, 'bar');
    
        MockDate.set('2019-01-01T08:02');
    
        val = await cache.get('foo');
    
        test.equals(val, undefined);

        MockDate.reset();
        cache.removeAllListeners();
    })

    test.test('Test set method ttl functionality', async test => {
        var cache = new Cache({
            ttl: 60
        });
    
        await cache.load();
    
        MockDate.set('2019-01-01T08:00');
    
        await cache.set('foo', 'bar', 120);
    
        var val = await cache.get('foo');
    
        test.equals(val, 'bar');
    
        MockDate.set('2019-01-01T08:02');
    
        val = await cache.get('foo');
    
        test.equals(val, 'bar');
    
        MockDate.set('2019-01-01T08:03');
    
        val = await cache.get('foo');
    
        test.equals(val, undefined);

        MockDate.reset();
        cache.removeAllListeners();
    })

    test.test('Test wrap method ttl functionality', async test => {
        var cache = new Cache({
            ttl: 60
        });
    
        await cache.load();
    
        MockDate.set('2019-01-01T08:00');
    
        await cache.wrap('foo', () => Promise.resolve('bar'), {ttl: 120});

        var val = await cache.get('foo');
    
        test.equals(val, 'bar');
    
        MockDate.set('2019-01-01T08:02');
        
        await cache.wrapPromises.foo
        val = await cache.get('foo');
        
        test.equals(val, 'bar');
    
        MockDate.set('2019-01-01T08:03');
    
        val = await cache.get('foo');
    
        test.equals(val, undefined);

        MockDate.reset();
        cache.removeAllListeners();
    })

    test.test('Test cache ttl as function', async test =>  {
        var cache = new Cache({
            ttl: function(key, value) {
                return value === 'bar' ? 60 : 120
            }
        });
    
        await cache.load();
    
        MockDate.set('2019-01-01T08:00');
    
        await cache.set('foo', 'bar');
    
        MockDate.set('2019-01-01T08:02');
    
        var val = await cache.get('foo');
    
        test.equals(val, undefined, 'When using conditional value from function, ttl is shorter.');
    
        val = await cache.set('foo', 'buzz');
    
        test.equals(val, 'buzz');
    
        MockDate.set('2019-01-01T08:04');
    
        val = await cache.get('foo');
    
        test.equals(val, 'buzz');
    
        MockDate.set('2019-01-01T08:05');
    
        val = await cache.get('foo');
    
        test.equals(val, undefined, 'Alternate control flow yields a longer ttl.');

        MockDate.reset();
        cache.removeAllListeners();
    })
})

tap.test('Test cache wrap', async test =>  {
    test.test('Test false returnStaleWhileRefreshing', async test => {
        var cache = new Cache({
            returnStaleWhileRefreshing: false,
            ttl: 59
        });
        MockDate.set('2019-01-01T08:00');
    
        var val = await cache.set('foo', 'buzz');

        var promise = cache.wrap('foo', () => new Promise(async resolve => {
            MockDate.set('2019-01-01T08:01');
            val = await cache.get('foo');
    
            test.equals(val, undefined);
            resolve('bag')
            val = await promise;
            
            test.equals(val, 'bag');

            MockDate.reset();
            cache.removeAllListeners();
        }));
    })

    test.test('Test true returnStaleWhileRefreshing', async test => {
        var cache = new Cache({
            returnStaleWhileRefreshing: true,
            ttl: 60
        });
        MockDate.set('2019-01-01T08:00');
    
        var val = await cache.set('foo', 'buzz');
    
        MockDate.set('2019-01-01T08:01');

        var promise = cache.wrap('foo', () => new Promise(async resolve => {
            val = await cache.get('foo');
    
            test.equals(val, 'buzz');
            resolve('bag')
            val = await promise;
            
            test.equals(val, 'bag');

            MockDate.reset();
            cache.removeAllListeners();
        }));
    })
})

tap.test('Test file store', async test =>  {
    MockDate.set('2019-01-01T08:00');
    mockFs();

    var cache = new Cache({
        ttl: 59,
        store: new FileStore
    });
    await cache.load();

    await cache.set('foo', 'bar');

    await cache.dumpPromise;

    items = await fs.readdir('tmp');

    test.equals(items.length, 2);
    
    var fileContents = await fs.readFile('tmp/8c736521.json');

    test.deepEquals(JSON.parse(fileContents.toString('utf8')), {"k":"foo","v":"bar","e":1546358459000});

    mockFs.restore();

    MockDate.reset();
    cache.removeAllListeners();
});

tap.test('Test multi write resolution', async test =>  {
    MockDate.set('2019-01-01T08:00');
    await rimraf('tmp');
    var cache = new Cache({
        ttl: 59,
        store: new FileStore({path: 'tmp'})
    });
    await cache.load();
    cache.set('foo', 'bar');
    cache.set('foo', 'bro');
    await cache.del('foo');
    await cache.set('foo', 'bru');
    await cache.dumpPromise//TODO make this go away
    var val = await cache.get('foo');

    test.equals(val, 'bru');

    await cache.dumpPromise;

    items = await fs.readdir('tmp');
    var val = await fs.readFile('tmp/8c736521.json');

    test.deepEquals(JSON.parse(val), {"k":"foo","v":"bru","e":1546358459000});

    MockDate.reset();
    await rimraf('tmp');
    cache.removeAllListeners();
});

tap.test('Test cache del', async test =>  {
    var cache = new Cache({
        ttl: 59,
        store: new FileStore
    });

    await cache.load();

    await cache.set('foo', 'bar');

    await cache.del('foo');

    items = await fs.readdir('tmp');

    test.deepEquals(items, [ '8c736521_meta.json' ]);
    
    await rimraf('tmp');
});

tap.test('Test set to file store with extremely long key', async test =>  {
    const longKey = 'feed_nba-media_video_lang=enUS&locale=en-US&secret=null&date=null&filter%5Bpromoted%5D=true&filter%5B%24and%5D%5B0%5D%5Btags%5D%5B%24ne%5D=MyTeam&filter%5B%24and%5D%5B1%5D%5Btags%5D%5B%24ne%5D=Playgrounds&filter%5B%24and%5D%5B2%5D%5Btags%5D%5B%24ne%5D=2KTV&skip=0&limit=8&sort%5BpublishDate%5D=-1&flatten=true&token=70bd7b40f30df772747d598dfb898f&populate=20&simple=true__temp_meta';
    var cache = new Cache({
        ttl: 59,
        store: new FileStore({path:'tmp5'})
    });
    await cache.load();

    await cache.set(longKey, 'bar');

    await cache.dumpPromise;

    items = await fs.readdir('tmp5');

    test.equals(items.length, 2);
    
    await rimraf('tmp5');
});

tap.test('Test file store keys', async test =>  {
    var cache = new Cache({
        ttl: 59,
        store: new FileStore({path:'tmp6'})
    });
    await cache.load();

    await cache.set('foo', 'bar');
    await cache.set('plus', 'minus');

    await cache.dumpPromise;

    var keys = await cache.stores[0].keys();

    test.deepEquals(keys, ['foo', 'plus']);
    
    await rimraf('tmp6');
});


tap.test('Test cache keys', async test =>  {
    var cache = new Cache({
        ttl: 59,
        store: new FileStore({path:'tmp6'})
    });
    await cache.load();

    await cache.set('foo', 'bar');
    await cache.set('plus', 'minus');

    await cache.dumpPromise;

    var keys = await cache.keys();

    test.deepEquals(keys, ['foo', 'plus']);
    
    await rimraf('tmp6');
});

tap.test('Test redis load with null values', async test =>  {
    var redisStore = new RedisStore({redisImplementation: redisMock});
    var cache = new Cache({
        ttl: 59,
        store: redisStore
    });
    await promisify(cache.store.client.set).bind(cache.store.client)('foo', 'null')
    await cache.load();

    test.ok(true)

    redisStore.client.flushall()
});

tap.test('Test redis cleanup bad values', async test =>  {
    var redisStore = new RedisStore({redisImplementation: redisMock});
    var cache = new Cache({
        ttl: 59,
        store: redisStore
    });
    await promisify(cache.store.client.set).bind(cache.store.client)('foo', '{"foo": "bar"}')
    await promisify(cache.store.client.set).bind(cache.store.client)('boo_meta', '{"foo": "bar"}')
    await cache.load();
    var keys = await cache.keys();

    await cache.dumpPromise;

    test.deepEquals(keys, cache.lru.keys());

    var val = await promisify(cache.store.client.get).bind(cache.store.client)('foo');

    test.equals(val, null);

    redisStore.client.flushall()
});

tap.test('Test redis values without bad values', async test =>  {
    var redisStore = new RedisStore({redisImplementation: redisMock});
    var cache = new Cache({
        ttl: 59,
        store: redisStore
    });
    await promisify(cache.store.client.set).bind(cache.store.client)('foo', '{"k": "bar", "v":"bar", "e": 10000}')
    await cache.load();

    await cache.dumpPromise;

    redisStore.client.flushall()

});

tap.test('Test refresh with no initial values', async test =>  {
    MockDate.set('2019-01-01T08:00');

    var cache = new Cache({
        ttl: 59,
        stores: [new FileStore({isPrimary: true, path: 'tmp4'})]
    });

    await cache.load()

    var val = await cache.wrap('foo', () => Promise.resolve('bar'))
    
    test.equals(val, 'bar');

    await cache.dumpPromise
    await rimraf('tmp4');

    MockDate.reset();
});

tap.test('Test multi / primary store with files', async test =>  {
    MockDate.set('2019-01-01T08:00');
    await rimraf('tmp2');
    await rimraf('tmp');

    var commonStore = new FileStore({path: 'tmp2', isPrimary: true})

    var cache = new Cache({
        ttl: 59, store: commonStore
    });

    var cache2 = new Cache({
        ttl: 59, store: commonStore, backupStores: [new FileStore({path: 'tmp'})]
    });

    // var items = await fs.readdir('tmp');

    // test.equals(items.length, 0);

    // items = await fs.readdir('tmp2');

    // test.equals(items.length, 0);

    await cache2.set('foo', 'bar');

    await cache2.dumpPromise

    var val = await cache.get('foo');
    /* todo test when we have returnStaleWhileRefreshing false */
    /* todo test when not isprimary */
    test.same(val, 'bar');

    await cache.refreshPromises.foo

    val = await cache.get('foo');

    test.equals(val, 'bar');

    await cache.dumpPromise;

    var items = await fs.readdir('tmp');
    var items2 = await fs.readdir('tmp2');

    test.deepEquals(items, items2, 'Both file stores have same files');

    await rimraf('tmp2');
    await rimraf('tmp');

    MockDate.reset();
});

tap.test('Test redis store', async test =>  {
    MockDate.set('2019-01-01T08:00');

    var redisStore = new RedisStore({redisImplementation: redisMock});
    var cache = new Cache({
        ttl: 59,
        store: redisStore
    });

    await cache.load();

    await cache.set('foo', 'bar');

    await cache.dumpPromise;

    items = await promisify(redisStore.client.keys)('*')

    test.equals(items.length, 2);
    
    var fileContents = await promisify(redisStore.client.get)('foo')

    test.deepEquals(JSON.parse(fileContents.toString('utf8')), {"k":"foo","v":"bar","e":1546358459000});
    redisStore.client.flushall()

    MockDate.reset();
});

tap.test('Test loading undefined values', async test =>  {
    var cache = new Cache({
        ttl: 59
    });

    test.ok(cache.load([{k: 'foo', v: undefined, e: Date.now() + 1000}]));
});



tap.test('Test multi / primary store with redis', async test =>  {
    MockDate.set('2019-01-01T08:00');

    var commonStore = new RedisStore({redisImplementation: redisMock, isPrimary: true});
    var singleStore = new RedisStore({redisImplementation: redisMock});
    var cache = new Cache({
        ttl: 59, store: commonStore
    });

    var cache2 = new Cache({
        ttl: 59,
        store: commonStore,
        backupStores: [singleStore]
    });

    await cache2.set('foo', 'bar');

    await cache2.dumpPromise

    var val = await cache.get('foo');
    /* todo test when we have returnStaleWhileRefreshing false */
    /* todo test when not isprimary */
    test.equals(val, 'bar');

    await cache.refreshPromises.foo

    val = await cache.get('foo');

    test.equals(val, 'bar');

    await cache.dumpPromise;

    var items = await promisify(commonStore.client.keys)('*')
    var items2 = await promisify(singleStore.client.keys)('*')

    test.deepEquals(items, items2, 'Both file stores have same files');
    singleStore.client.flushall()
    commonStore.client.flushall()

    MockDate.reset();
});

tap.test('Test redis del', async test =>  {
    MockDate.set('2019-01-01T08:00');

    var redisStore = new RedisStore({redisImplementation: redisMock});
    var cache = new Cache({
        ttl: 59,
        store: redisStore
    });

    await cache.load();

    await cache.set('foo', 'bar');

    await cache.del('foo');

    await cache.dumpPromise;

    var val = await cache.get('foo');

    test.notOk(val);
    redisStore.client.flushall()
    MockDate.reset();
});



tap.test('Test keys globbing redis', async test =>  {
    MockDate.set('2019-01-01T08:00');

    var redisStore = new RedisStore({redisImplementation: redisMock});
    var cache = new Cache({
        ttl: 59,
        store: redisStore
    });

    await cache.load();
    await cache.set('foo', 'bar');
    await cache.set('foo_34', 'bar');
    await cache.set('bar', 'foo');

    await cache.dumpPromise;

    var keys = await cache.keys('foo*');

    test.deepEquals(keys, ['foo', 'foo_34']);

    redisStore.client.flushall();
    MockDate.reset();
});


tap.test('Test purging already expired items from redis', async test =>  {
    MockDate.set('2019-01-01T08:00');

    var redisStore = new RedisStore({redisImplementation: redisMock});
    var cache = new Cache({
        ttl: 59,
        store: redisStore
    });

    await promisify(redisStore.client.set)('foo', `{"k": "foo", "v": "barley", "e": ${new Date('2019-01-01T08:00').getTime() - 100} }`)

    await cache.load();
    await cache.del('foo', 'bar');

    var val = await promisify(redisStore.client.get)('foo');
    
    test.notOk(val);

    MockDate.reset();
});


tap.test('Test multi / primary store with del operation on missing file', async test =>  {
    MockDate.set('2019-01-01T08:00');
    await rimraf('tmp2');
    await rimraf('tmp');
    var redisStore = new RedisStore({redisImplementation: redisMock});
    // var redisStore2 = new RedisStore({redisImplementation: redisMock});

    // var commonStore = new FileStore({path: 'tmp2', isPrimary: true})

    var cache = new Cache({
        ttl: 59, store: redisStore, backupStores: [new FileStore({path: 'tmp2'})]
    });

    var cache2 = new Cache({
        ttl: 59, store: redisStore, backupStores: [new FileStore({path: 'tmp'})]
    });

    await cache.load();
    await cache2.set('foo', 'bar');

    await cache2.dumpPromise

    var val = await cache.get('foo');

    await rimraf('tmp');

    await cache2.del('foo');

    test.ok(true)

    await rimraf('tmp2');
    await rimraf('tmp');
    redisStore.client.flushall()
    MockDate.reset();
});

tap.test('Test del then get has refreshed data immediately', async test =>  {
    MockDate.set('2019-01-01T08:00');
    await rimraf('tmp2');
    var redisStore = new RedisStore({redisImplementation: redisMock});

    var cache = new Cache({
        ttl: 59, store: redisStore, backupStores: [new FileStore({path: 'tmp2'})]
    });

    await cache.load();
    await cache.set('foo', 'bar');

    await cache.dumpPromise

    await cache.del('foo');

    var val = await cache.get('foo');

    test.notOk(val)

    await cache.set('foo', 'man');

    val = await promisify(redisStore.client.get).bind(redisStore.client)('foo')

    test.equals(val, '{"k":"foo","v":"man","e":1546358459000}')

    await promisify(redisStore.client.del).bind(redisStore.client)('foo')

    val = await cache.get('foo')

    test.same(val, null)

    await cache.dumpPromise
    await cache.refreshPromises.foo
    
    await promisify(redisStore.client.set).bind(redisStore.client)('foo', '{"k":"foo","v":"bash","e":1556358459000}')
    await promisify(redisStore.client.set).bind(redisStore.client)('foo_meta', '{"setTime": 1556358459000, "key": "foo" }')

    val = await cache.get('foo')
    
    test.same(val, 'bash')

    await cache.refreshPromises.foo

    val = await cache.get('foo')

    test.equals(val, 'bash')

    await cache.dumpPromise
    await rimraf('tmp2');
    redisStore.client.flushall()
    MockDate.reset();
});

tap.test('Del forces new value from wrap function', async test =>  {
    MockDate.set('2019-01-01T08:00');
    await rimraf('tmp2');
    var redisStore = new RedisStore({redisImplementation: redisMock});

    var cache = new Cache({
        ttl: 59, store: redisStore, backupStores: [new FileStore({path: 'tmp2'})]
    });

    var val = await cache.wrap('bang', () => {
        return Promise.resolve('window');
    }, {ttl: 60 });

    test.same(val, 'window')

    await cache.del('bang');

    val = await cache.wrap('bang', () => {
        return Promise.resolve('windows');
    }, { ttl: 60 });

    test.same(val, 'windows');

    await cache.dumpPromise
    await rimraf('tmp2');
    redisStore.client.flushall()
    MockDate.reset();
});

tap.test('Wrap pulls in new value from remote in distributed environment', async test =>  {
    MockDate.set('2019-01-01T08:00');
    await rimraf('tmp2');
    await rimraf('tmp');
    var alternate = false;
    var redisStore = new RedisStore({redisImplementation: redisMock});

    var cache = new Cache({
        ttl: 59, store: redisStore, backupStores: [new FileStore({path: 'tmp2'})]
    });

    var cache2 = new Cache({
        ttl: 59, store: redisStore, backupStores: [new FileStore({path: 'tmp'})]
    });
    var fetchFunc = () => {
        if (alternate) {
            return Promise.resolve('broken window');
        }
        return Promise.resolve('window');
    };

    var val = await cache.wrap('bang', fetchFunc, {ttl: 60 });

    test.same(val, 'window');

    await cache.dumpPromise;
    alternate = true;
    
    var val2 = await cache2.wrap('bang', fetchFunc, {ttl: 60 });

    test.same(val2, 'window');

    await cache.dumpPromise
    await rimraf('tmp2');
    await rimraf('tmp');
    redisStore.client.flushall()
    MockDate.reset();
});

tap.test('Del forces wrap to refresh in distributed environment', async test =>  {
    MockDate.set('2019-01-01T08:00');
    await rimraf('tmp2');
    await rimraf('tmp');
    var alternate = false;
    var redisStore = new RedisStore({redisImplementation: redisMock});

    var cache = new Cache({
        ttl: 59, store: redisStore, backupStores: [new FileStore({path: 'tmp2'})]
    });

    var cache2 = new Cache({
        ttl: 59, store: redisStore, backupStores: [new FileStore({path: 'tmp'})]
    });
    var fetchFunc = () => {
        if (alternate) {
            return Promise.resolve('broken window');
        }
        return Promise.resolve('window');
    };

    var val = await cache.wrap('bang_blah', fetchFunc, {ttl: 60 });

    test.same(val, 'window');

    await cache.dumpPromise;
    alternate = true;
    var keys = await cache2.keys('bang_*');
    test.deepEquals(['bang_blah'], keys)
    await cache2.del(keys)
    // await Promise.all(keys.map(key => cache2.del(key)));

    var val2 = await cache2.wrap('bang_blah', fetchFunc, {ttl: 60 });

    test.same(val2, 'broken window');

    await cache.dumpPromise
    await rimraf('tmp2');
    await rimraf('tmp');
    redisStore.client.flushall()
    MockDate.reset();
});


tap.test('Del forces wrap to refresh in distributed environment, even with fallback value', async test =>  {
    MockDate.set('2019-01-01T08:00');
    await rimraf('tmp2');
    await rimraf('tmp');

    var alternate = false;
    var redisStore = new RedisStore({redisImplementation: redisMock});

    var cache = new Cache({
        ttl: 59, store: redisStore, backupStores: [new FileStore({path: 'tmp2'})]
    });

    var cache2 = new Cache({
        ttl: 59, store: redisStore, backupStores: [new FileStore({path: 'tmp'})]
    });

    var fetchFunc = () => {
        if (alternate) {
            return Promise.resolve('broken window');
        }
        return Promise.resolve('window');
    }

    var val = await cache.wrap('bang_blah', fetchFunc, {ttl: 60 });
    var val2 = await cache2.wrap('bang_blah', fetchFunc, {ttl: 60 });
    await cache.dumpPromise;
    await cache2.dumpPromise;
    test.same(val, 'window');
    test.same(val, val2);

    MockDate.set('2019-01-01T08:02');

    val2 = await cache2.wrap('bang_blah', fetchFunc, {ttl: 60 });
    val = await cache.wrap('bang_blah', fetchFunc, {ttl: 60 });
    await cache.dumpPromise;
    await cache2.dumpPromise;
    
    alternate = true;
    var keys = await cache2.keys('bang_*');

    test.deepEquals(['bang_blah'], keys)
    await cache2.del(keys);

    val2 = await cache2.wrap('bang_blah', fetchFunc, {ttl: 60 });
    val = await cache.wrap('bang_blah', fetchFunc, {ttl: 60 });

    test.same(val, 'broken window');
    test.same(val2, 'broken window');

    await cache.dumpPromise
    await rimraf('tmp2');
    await rimraf('tmp');
    redisStore.client.flushall()
    MockDate.reset();
});

tap.test('Deleting multiple keys works with redis store', async test =>  {
    MockDate.set('2019-01-01T08:00');
    await rimraf('tmp2');
    await rimraf('tmp');
    
    var redisStore = new RedisStore({redisImplementation: redisMock});

    var cache = new Cache({
        ttl: 59, store: redisStore, backupStores: [new FileStore({path: 'tmp2'})]
    });

    var cache2 = new Cache({
        ttl: 59, store: redisStore, backupStores: [new FileStore({path: 'tmp'})]
    });

    await cache.set('hi', 'boo')
    await cache.wrap('hi2', () => 'boo2')
    await cache.set('hi3', 'boo3')

    await cache.dumpPromise

    await cache.get('hi')
    await cache.get('hi2')
    await cache.get('hi3')

    await cache.dumpPromise
    await cache.refreshPromises.hi2

    MockDate.set('2019-01-01T08:10');

    await cache2.set('hi', 'booo')
    await cache2.set('hi3', 'booo3')
    await cache2.wrap('hi2', () => 'booo2')

    await cache2.get('hi')
    await cache2.get('hi2')
    await cache2.get('hi3')

    await cache2.dumpPromise
    await cache2.refreshPromises.hi2
    
    var keys = await cache.keys('hi*')

    await cache.del(keys)

    await cache.dumpPromise
    await rimraf('tmp2');
    await rimraf('tmp');
    redisStore.client.flushall()
    MockDate.reset();
});


/* TODO MAKE TEST COVERING BUG WITH GETTING NULL VALUE FOR SETSERIALIZED */