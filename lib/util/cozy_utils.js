goog.provide('shaka.util.CozyUtils');

goog.require('goog.asserts');
goog.require('shaka.net.NetworkingEngine');
goog.require('shaka.util.AbortableOperation');
goog.require('shaka.util.Error');
goog.require('shaka.util.StringUtils');
goog.require('shaka.util.Timer');


/**
 * @namespace shaka.util.CozyUtils
 * @summary Utility functions for Cozy support.
 */


 /**
  * @typedef {{
  *   exists: string,
  *   doctype: string,
  *   type: string,
  *   name: string,
  *   fields: Array.<string>
  * }}
  *
  * @description
  * Defines a time range of a media segment.  Times are in seconds.
  *
  * @property {string} exists
  *   Whether the index already exists or not.
  * @property {string} doctype
  *   The type of the doocument.
  * @property {string} type
  *   The type of the index.
  * @property {string} name
  *   The name of the index.
  * @property {string} fields
  *   The fields of the index.
  */
 shaka.util.CozyUtils.IndexReference;

 /**
  * @typedef {{
  *   domain: string,
  *   token: string
  * }}
  *
  * @description
  * Cozy relative information
  *
  * @property {string} domain
  *   The domain of the Cozy.
  * @property {string} token
  *   The token of the cozy.
  */
 shaka.util.CozyUtils.CozyInfo;


/**
 * Resolves an array of relative URIs to the given base URIs. This will result
 * in M*N number of URIs. Only to get Cozy Uris.
 *
 * @param {!Promise.<!Array.<string>>} baseUris
 * @param {!Array.<string>} relativeUris
 * @param {!shaka.extern.RetryParameters} retryParameters
 * @param {!shaka.net.NetworkingEngine} networkingEngine
 * @param {shaka.util.CozyUtils.CozyInfo} cozy
 * @return {!shaka.util.AbortableOperation.<!Array.<string>>}
 */
shaka.util.CozyUtils.resolveCozyUris =
  function(baseUris, relativeUris, retryParameters, networkingEngine, cozy) {
  // if (relativeUris.length == 0) {
  //   return shaka.util.AbortableOperation.completed(baseUris);
  // }

  const CozyUtils = shaka.util.CozyUtils;
  const Error = shaka.util.Error;

  // Only files placed in the same directory as the mpd are supported for now
  let fileName = relativeUris[0].split('/');
  fileName = fileName[fileName.length - 1];

  return CozyUtils.defineFileIndex(
    ['name'], cozy, retryParameters, networkingEngine)
  .chain((indexRef) => {
    const opts = {'selector': {name: fileName} };
    return CozyUtils.query(
      indexRef, opts, cozy, retryParameters, networkingEngine);
  })
  .chain((docs) => {
    // We keep the first result matching the query for now.
    // Does not support multiple files with the same name in the VFS
    const doc = docs[0];

    if(doc['name'] !== fileName) {
      return shaka.util.AbortableOperation.failed(new Error(
        Error.Severity.CRITICAL, Error.Category.MANIFEST,
        Error.Code.DASH_INVALID_XML, fileName));
    }

    return CozyUtils.getDownloadLinkById(
      doc['_id'], cozy, retryParameters, networkingEngine);
  });
  //   index, {'selector': {mime: 'application/dash+xml'} }));


};

/**
 * Find documents using an index
 *
 * @param {!shaka.util.CozyUtils.IndexReference} indexRef
 * @param {?} opts
 * @param {!shaka.util.CozyUtils.CozyInfo} cozy
 * @param {!shaka.extern.RetryParameters} retryParameters
 * @param {!shaka.net.NetworkingEngine} networkingEngine
 * @return {!shaka.util.AbortableOperation.<!Array.<string>>}
 */
 shaka.util.CozyUtils.query =
    function(indexRef, opts, cozy, retryParameters, networkingEngine) {
   const CozyUtils = shaka.util.CozyUtils;

   const allOpts = {
     'use_index': indexRef.name,
     'selector': opts['selector']
   };

   const path = '//' + cozy.domain + '/data/' + indexRef.doctype + '/_find';

   const request = CozyUtils.cozyRequest(
     cozy['token'], retryParameters, 'POST', path, allOpts);
   const networkOperation = CozyUtils.cozyOperation(
     networkingEngine, request);

   return networkOperation.chain((response) => {
     const responseDataString = shaka.util.StringUtils.fromUTF8(response.data);
     const responseData = JSON.parse(responseDataString);

     return responseData['docs'];
   });
 };

/**
 * Create a Mango Index with a given selector
 *
 * @param {!Array.<string>} fields
 * @param {!shaka.util.CozyUtils.CozyInfo} cozy
 * @param {!shaka.extern.RetryParameters} retryParameters
 * @param {!shaka.net.NetworkingEngine} networkingEngine
 * @return {!shaka.util.AbortableOperation.<!Array.<string>>}
 */
shaka.util.CozyUtils.defineFileIndex =
  function(fields, cozy, retryParameters, networkingEngine) {

  const path = '//' + cozy.domain + '/data/' + 'io.cozy.files' + '/_index';
  let indexDefinition = { index: {} };
  indexDefinition.index['fields'] = fields;

  const request = shaka.util.CozyUtils.cozyRequest(
    cozy['token'], retryParameters, 'POST', path, indexDefinition);

  let networkOperation = shaka.util.CozyUtils.cozyOperation(
    networkingEngine, request);

  // Chain onto that operation.
  return networkOperation.chain((response) => {
    const responseDataString = shaka.util.StringUtils.fromUTF8(response.data);
    const responseData = JSON.parse(responseDataString);

    // TODO: handle error
    // const contentType = response.headers.get('content-type');
    // if (!contentType || contentType.indexOf('json') < 0) {
    //   return shaka.util.AbortableOperation.failed(new Error(
    //       Error.Severity.CRITICAL, Error.Category.MANIFEST,
    //       Error.Code.DASH_INVALID_XML, fields));
    // }

    const indexResult = {
      exists: responseData.result,
      doctype: 'io.cozy.files',
      type: 'mango',
      name: responseData.id,
      fields
    };

    return indexResult;
  })
  .chain((indexRes) => {
    // indexes might not be usable right after being created;
    // so we delay the resolving until they are
    let selector = {};
    selector[fields[0]] = {
      '$gt': null
    };

    const opts = { 'selector': selector };
    const path = '//' + cozy.domain + '/data/' + 'io.cozy.files' + '/_find';

    const request = shaka.util.CozyUtils.cozyRequest(
      cozy['token'], retryParameters, 'POST', path, opts);

    let networkOperation = shaka.util.CozyUtils.cozyOperation(
      networkingEngine, request);

    return networkOperation.chain(() => { return indexRes; }, (error) => {
      const retryTimeout = new Promise(function(resolve) {
        const timer = new shaka.util.Timer(resolve);
        timer.tickAfter(/* seconds= */ 1);
      });

      return retryTimeout.then(() => {
        let networkOperationRet = shaka.util.CozyUtils.cozyOperation(
          networkingEngine, request);

        return networkOperationRet.chain(() => { return indexRes; }, (error) => {
          const retryTimeoutRet = new Promise(function(resolve) {
            const timer = new shaka.util.Timer(resolve);
            timer.tickAfter(/* seconds= */ 0.5);
          });

          return retryTimeoutRet.then(() => { return indexRes; });
        });
      });
    });
  });
};


/**
 * Ask a download link to the file linked to the specified ID
 *
 * @param {string} id
 * @param {!shaka.util.CozyUtils.CozyInfo} cozy
 * @param {!shaka.extern.RetryParameters} retryParameters
 * @param {!shaka.net.NetworkingEngine} networkingEngine
 * @return {!shaka.util.AbortableOperation.<!Array.<string>>}
 */
shaka.util.CozyUtils.getDownloadLinkById = function(
    id, cozy, retryParameters, networkingEngine) {
  const CozyUtils = shaka.util.CozyUtils;

  const path = '//' + cozy.domain + '/files/downloads?Id=' + id;

  const request = CozyUtils.cozyRequest(
    cozy['token'], retryParameters, 'POST', path, null);
  const networkOperation = CozyUtils.cozyOperation(
    networkingEngine, request);

  return networkOperation.chain((response) => {
    const responseDataString = shaka.util.StringUtils.fromUTF8(response.data);
    const responseData = JSON.parse(responseDataString);

    const fileUri = responseData['links'] && responseData['links']['related'];
    const fullFileUri = '//' + cozy.domain + fileUri;

    // TODO normally this has to handle all passed uris, not only the 1st one
    return [fullFileUri];
  });
};


/**
 * Create a Cozy request
 *
 * @param {string} cozyToken
 * @param {!shaka.extern.RetryParameters} retryParameters
 * @param {string} method
 * @param {string} path
 * @param {?Object} body
 * @return {shaka.extern.Request}
 */
shaka.util.CozyUtils.cozyRequest =
    function(cozyToken, retryParameters, method, path, body) {

  // const authorization = 'Bearer ' + cozyToken;

  /** @type {shaka.extern.Request} */
  let request;

  if(body !== null) {
    const bodyStringified = JSON.stringify(body);
    const bodyUTF8 = shaka.util.StringUtils.toUTF8(bodyStringified);

    request = {
      uris: [path],
      method: method,
      body: bodyUTF8,
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${cozyToken}`,
        'Content-Type': 'application/json'
      },
      allowCrossSiteCredentials: true,
      retryParameters: retryParameters,
      licenseRequestType: null,
      sessionId: null,
    };
  } else {
    request = {
      uris: [path],
      method: method,
      body: null,
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${cozyToken}`,
        'Content-Type': 'application/json'
      },
      allowCrossSiteCredentials: true,
      retryParameters: retryParameters,
      licenseRequestType: null,
      sessionId: null,
    };
  }

  return request;
};

/**
 * Create a NetworkingEngine operations
 *
 * @param {shaka.net.NetworkingEngine} networkingEngine
 * @param {shaka.extern.Request} request
 * @return {!shaka.util.AbortableOperation.<shaka.extern.Response>}
 */
 shaka.util.CozyUtils.cozyOperation =
    function(networkingEngine, request) {
  const requestType = shaka.net.NetworkingEngine.RequestType.MANIFEST;

  const requestOperation = networkingEngine.request(requestType, request);
  // The interface is abstract, but we know it was implemented with the
  // more capable internal class.
  goog.asserts.assert(requestOperation instanceof shaka.util.AbortableOperation,
                      'Unexpected implementation of IAbortableOperation!');
  // Satisfy the compiler with a cast.
  const networkOperation =
      /** @type {!shaka.util.AbortableOperation.<shaka.extern.Response>} */(
          requestOperation);

  return networkOperation;
};
