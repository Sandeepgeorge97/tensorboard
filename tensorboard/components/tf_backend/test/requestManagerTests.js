var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
/* Copyright 2015 The TensorFlow Authors. All Rights Reserved.

Licensed under the Apache License, Version 2.0 (the 'License');
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an 'AS IS' BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
==============================================================================*/
var tf_backend;
(function (tf_backend) {
    const { expect } = chai;
    class MockedRequestManager extends tf_backend.RequestManager {
        constructor(maxRequests = 10, maxRetries = 3) {
            super(maxRequests, maxRetries);
            this.resolvers = [];
            this.rejectors = [];
            this.requestsDispatched = 0;
        }
        _promiseFromUrl(url) {
            return new Promise((resolve, reject) => {
                const mockJSON = {
                    ok: true,
                    json() {
                        return url;
                    },
                    url,
                    status: 200,
                };
                const mockFailedRequest = {
                    ok: false,
                    url,
                    status: 502,
                };
                const mockFailure = new tf_backend.RequestNetworkError(mockFailedRequest, url);
                this.resolvers.push(() => {
                    resolve(mockJSON);
                });
                this.rejectors.push(() => {
                    reject(mockFailure);
                });
                this.requestsDispatched++;
            });
        }
        resolveFakeRequest() {
            this.resolvers.pop()();
        }
        rejectFakeRequest() {
            this.rejectors.pop()();
        }
        dispatchAndResolve() {
            // Wait for at least one request to be dispatched, then resolve it.
            this.waitForDispatch(1).then(() => this.resolveFakeRequest());
        }
        waitForDispatch(num) {
            return waitForCondition(() => {
                return this.requestsDispatched >= num;
            });
        }
    }
    /** Create a promise that returns when *check* returns true.
     * May cause a test timeout if check never becomes true.
     */
    function waitForCondition(check) {
        return new Promise((resolve, reject) => {
            const go = () => {
                if (check()) {
                    resolve();
                }
                setTimeout(go, 2);
            };
            go();
        });
    }
    describe('backend', () => {
        let sandbox;
        beforeEach(() => {
            sandbox = sinon.sandbox.create();
        });
        afterEach(() => {
            sandbox.restore();
        });
        describe('request manager', () => {
            it('request loads JSON properly', (done) => {
                const rm = new tf_backend.RequestManager();
                const promise = rm.request('data/example.json');
                promise.then((response) => {
                    chai.assert.deepEqual(response, { foo: 3, bar: 'zoidberg' });
                    done();
                }, (reject) => {
                    throw new Error(reject);
                });
            });
            it('rejects on bad url', (done) => {
                const rm = new tf_backend.RequestManager(5, 0);
                const badUrl = '_bad_url_which_doesnt_exist.json';
                const promise = rm.request(badUrl);
                promise.then((success) => {
                    done(new Error('the promise should have rejected'));
                }, (reject) => {
                    chai.assert.include(reject.message, '404');
                    chai.assert.include(reject.message, badUrl);
                    chai.assert.equal(reject.req.status, 404);
                    done();
                });
            });
            it('can retry if requests fail', (done) => {
                const rm = new MockedRequestManager(3, 5);
                const r = rm.request('foo');
                rm.waitForDispatch(1)
                    .then(() => {
                    rm.rejectFakeRequest();
                    return rm.waitForDispatch(2);
                })
                    .then(() => rm.resolveFakeRequest());
                r.then((success) => done());
            });
            it('retries at most maxRetries times', (done) => {
                const MAX_RETRIES = 2;
                const rm = new MockedRequestManager(3, MAX_RETRIES);
                const r = rm.request('foo');
                rm.waitForDispatch(1)
                    .then(() => {
                    rm.rejectFakeRequest();
                    return rm.waitForDispatch(2);
                })
                    .then(() => {
                    rm.rejectFakeRequest();
                    return rm.waitForDispatch(3);
                })
                    .then(() => {
                    rm.rejectFakeRequest();
                });
                r.then((success) => done(new Error('The request should have failed')), (failure) => done());
            });
            it('requestManager only sends maxRequests requests at a time', (done) => {
                const rm = new MockedRequestManager(3);
                const r0 = rm.request('1');
                const r1 = rm.request('2');
                const r2 = rm.request('3');
                const r3 = rm.request('4');
                chai.assert.equal(rm.activeRequests(), 3, 'three requests are active');
                chai.assert.equal(rm.outstandingRequests(), 4, 'four requests are pending');
                rm.waitForDispatch(3)
                    .then(() => {
                    chai.assert.equal(rm.activeRequests(), 3, 'three requests are still active (1)');
                    chai.assert.equal(rm.requestsDispatched, 3, 'three requests were dispatched');
                    rm.resolveFakeRequest();
                    return rm.waitForDispatch(4);
                })
                    .then(() => {
                    chai.assert.equal(rm.activeRequests(), 3, 'three requests are still active (2)');
                    chai.assert.equal(rm.requestsDispatched, 4, 'four requests were dispatched');
                    chai.assert.equal(rm.outstandingRequests(), 3, 'three requests are pending');
                    rm.resolveFakeRequest();
                    rm.resolveFakeRequest();
                    rm.resolveFakeRequest();
                    return r3;
                })
                    .then(() => {
                    chai.assert.equal(rm.activeRequests(), 0, 'all requests finished');
                    chai.assert.equal(rm.outstandingRequests(), 0, 'no requests pending');
                    done();
                });
            });
            it('queue continues after failures', (done) => {
                const rm = new MockedRequestManager(1, 0);
                const r0 = rm.request('1');
                const r1 = rm.request('2');
                rm.waitForDispatch(1).then(() => {
                    rm.rejectFakeRequest();
                });
                r0.then((success) => done(new Error('r0 should have failed')), (failure) => 'unused_argument')
                    .then(() => rm.resolveFakeRequest());
                // When the first request rejects, it should decrement nActiveRequests
                // and then launch remaining requests in queue (i.e. this one)
                r1.then((success) => done(), (failure) => done(new Error(failure)));
            });
            it('queue is LIFO', (done) => {
                /* This test is a bit tricky.
                 * We want to verify that the RequestManager queue has LIFO semantics.
                 * So we construct three requests off the bat: A, B, C.
                 * So LIFO semantics ensure these will resolve in order A, C, B.
                 * (Because the A request launches immediately when we create it, it's
                 * not in queue)
                 * Then after resolving A, C moves out of queue, and we create X.
                 * So expected final order is A, C, X, B.
                 * We verify this with an external var that counts how many requests were
                 * resolved.
                 */
                const rm = new MockedRequestManager(1);
                let nResolved = 0;
                function assertResolutionOrder(expectedSpotInSequence) {
                    return () => {
                        nResolved++;
                        chai.assert.equal(expectedSpotInSequence, nResolved);
                    };
                }
                function launchThirdRequest() {
                    rm.request('started late but goes third')
                        .then(assertResolutionOrder(3))
                        .then(() => rm.dispatchAndResolve());
                }
                rm.request('first')
                    .then(assertResolutionOrder(1)) // Assert that this one resolved first
                    .then(launchThirdRequest)
                    .then(() => rm.dispatchAndResolve()); // then trigger the next one
                rm.request('this one goes fourth') // created second, will go last
                    .then(assertResolutionOrder(4)) // assert it was the fourth to get resolved
                    .then(done); // finish the test
                rm.request('second')
                    .then(assertResolutionOrder(2))
                    .then(() => rm.dispatchAndResolve());
                rm.dispatchAndResolve();
            });
            it('requestManager can clear queue', (done) => {
                const rm = new MockedRequestManager(1);
                let requestsResolved = 0;
                let requestsRejected = 0;
                const success = () => requestsResolved++;
                const failure = (err) => {
                    chai.assert.equal(err.name, 'RequestCancellationError');
                    requestsRejected++;
                };
                const finishTheTest = () => {
                    chai.assert.equal(rm.activeRequests(), 0, 'no requests still active');
                    chai.assert.equal(rm.requestsDispatched, 1, 'only one req was ever dispatched');
                    chai.assert.equal(rm.outstandingRequests(), 0, 'no pending requests');
                    chai.assert.equal(requestsResolved, 1, 'one request got resolved');
                    chai.assert.equal(requestsRejected, 4, 'four were cancelled and threw errors');
                    done();
                };
                rm.request('0').then(success, failure).then(finishTheTest);
                rm.request('1').then(success, failure);
                rm.request('2').then(success, failure);
                rm.request('3').then(success, failure);
                rm.request('4').then(success, failure);
                chai.assert.equal(rm.activeRequests(), 1, 'one req is active');
                rm.waitForDispatch(1).then(() => {
                    chai.assert.equal(rm.activeRequests(), 1, 'one req is active');
                    chai.assert.equal(rm.requestsDispatched, 1, 'one req was dispatched');
                    chai.assert.equal(rm.outstandingRequests(), 5, 'five reqs outstanding');
                    rm.clearQueue();
                    rm.resolveFakeRequest();
                    // resolving the first request triggers finishTheTest
                });
            });
            it('throws an error when a GET request has a body', function () {
                const rm = new tf_backend.RequestManager();
                const badOptions = new tf_backend.RequestOptions();
                badOptions.methodType = tf_backend.HttpMethodType.GET;
                badOptions.body = "a body";
                chai.assert.throws(() => rm.requestWithOptions("http://www.google.com", badOptions), tf_backend.InvalidRequestOptionsError);
            });
            describe('tests using sinon.fakeServer', function () {
                let server;
                beforeEach(function () {
                    server = sinon.fakeServer.create();
                    server.respondImmediately = true;
                    server.respondWith("{}");
                });
                afterEach(function () {
                    server.restore();
                });
                it('builds correct XMLHttpRequest when request(url) is called', function () {
                    const rm = new tf_backend.RequestManager();
                    return rm.request("my_url")
                        .then(() => {
                        chai.assert.lengthOf(server.requests, 1);
                        chai.assert.equal(server.requests[0].url, "my_url");
                        chai.assert.equal(server.requests[0].requestBody, null);
                        chai.assert.equal(server.requests[0].method, tf_backend.HttpMethodType.GET);
                        chai.assert.notProperty(server.requests[0].requestHeaders, "Content-Type");
                    });
                });
                it('builds correct XMLHttpRequest when request(url, postData) is called', function () {
                    const rm = new tf_backend.RequestManager();
                    return rm.request("my_url", { "key1": "value1", "key2": "value2" })
                        .then(() => {
                        chai.assert.lengthOf(server.requests, 1);
                        chai.assert.equal(server.requests[0].url, "my_url");
                        chai.assert.equal(server.requests[0].method, tf_backend.HttpMethodType.POST);
                        chai.assert.instanceOf(server.requests[0].requestBody, FormData);
                        chai.assert.sameDeepMembers(Array.from(server.requests[0].requestBody.entries()), [["key1", "value1"], ["key2", "value2"]]);
                    });
                });
                it('builds correct XMLHttpRequest when requestWithOptions is called', function () {
                    const rm = new tf_backend.RequestManager();
                    const requestOptions = new tf_backend.RequestOptions();
                    requestOptions.methodType = tf_backend.HttpMethodType.POST;
                    requestOptions.contentType = "text/plain;charset=utf-8";
                    requestOptions.body = "the body";
                    return rm.requestWithOptions("my_url", requestOptions)
                        .then(() => {
                        chai.assert.lengthOf(server.requests, 1);
                        chai.assert.equal(server.requests[0].url, "my_url");
                        chai.assert.equal(server.requests[0].method, tf_backend.HttpMethodType.POST);
                        chai.assert.equal(server.requests[0].requestBody, "the body");
                        chai.assert.equal(server.requests[0].requestHeaders["Content-Type"], "text/plain;charset=utf-8");
                    });
                });
            });
            describe('fetch', () => {
                beforeEach(function () {
                    this.stubbedFetch = sandbox.stub(window, 'fetch');
                    this.clock = sandbox.useFakeTimers();
                    this.resolvesAfter = function (value, timeInMs) {
                        return new Promise((resolve) => {
                            setTimeout(() => resolve(value), timeInMs);
                        });
                    };
                });
                it('resolves', function () {
                    return __awaiter(this, void 0, void 0, function* () {
                        this.stubbedFetch.returns(Promise.resolve(new Response('Success', { status: 200 })));
                        const rm = new tf_backend.RequestManager();
                        const response = yield rm.fetch('foo');
                        expect(response).to.have.property('ok', true);
                        expect(response).to.have.property('status', 200);
                        const body = yield response.text();
                        expect(body).to.equal('Success');
                    });
                });
                it('retries', function () {
                    return __awaiter(this, void 0, void 0, function* () {
                        this.stubbedFetch.onCall(0).returns(Promise.resolve(new Response('Error 1', { status: 500 })));
                        this.stubbedFetch.onCall(1).returns(Promise.resolve(new Response('Error 2', { status: 500 })));
                        this.stubbedFetch.onCall(2).returns(Promise.resolve(new Response('Success', { status: 200 })));
                        const rm = new tf_backend.RequestManager();
                        const response = yield rm.fetch('foo');
                        expect(response).to.have.property('ok', true);
                        expect(response).to.have.property('status', 200);
                        const body = yield response.text();
                        expect(body).to.equal('Success');
                    });
                });
                it('gives up after max retries', function () {
                    return __awaiter(this, void 0, void 0, function* () {
                        const failure = new Response('Error', { status: 500 });
                        this.stubbedFetch.returns(Promise.resolve(failure));
                        const rm = new tf_backend.RequestManager();
                        const response = yield rm.fetch('foo');
                        expect(this.stubbedFetch).to.have.been.calledThrice;
                        expect(response).to.have.property('ok', false);
                        expect(response).to.have.property('status', 500);
                        const body = yield response.text();
                        expect(body).to.equal('Error');
                    });
                });
                it('sends requests concurrently', function () {
                    return __awaiter(this, void 0, void 0, function* () {
                        this.stubbedFetch.onCall(0).returns(this.resolvesAfter(new Response('nay', { status: 200 }), 3000));
                        this.stubbedFetch.onCall(1).returns(Promise.resolve(new Response('yay', { status: 200 })));
                        const rm = new tf_backend.RequestManager(/** nSimultaneousRequests */ 2);
                        const promise1 = rm.fetch('foo');
                        const promise2 = rm.fetch('bar');
                        const secondResponse = yield Promise.race([promise1, promise2]);
                        const secondBody = yield secondResponse.text();
                        expect(secondBody).to.equal('yay');
                        this.clock.tick(3000);
                        const firstResponse = yield promise1;
                        const firstBody = yield firstResponse.text();
                        expect(firstBody).to.equal('nay');
                    });
                });
                it('queues requests', function () {
                    return __awaiter(this, void 0, void 0, function* () {
                        this.stubbedFetch.onCall(0).returns(this.resolvesAfter(new Response('nay', { status: 200 }), 3000));
                        this.stubbedFetch.onCall(1).returns(Promise.resolve(new Response('yay', { status: 200 })));
                        const rm = new tf_backend.RequestManager(/** nSimultaneousRequests */ 1);
                        const promise1 = rm.fetch('foo');
                        const promise2 = rm.fetch('bar');
                        expect(rm.activeRequests()).to.equal(1);
                        expect(rm.outstandingRequests()).to.equal(2);
                        this.clock.tick(3000);
                        const firstResponse = yield Promise.race([promise1, promise2]);
                        const firstBody = yield firstResponse.text();
                        expect(firstBody).to.equal('nay');
                        const secondResponse = yield promise2;
                        const secondBody = yield secondResponse.text();
                        expect(secondBody).to.equal('yay');
                    });
                });
            });
        });
    });
})(tf_backend || (tf_backend = {})); // namespace tf_backend
