import fs from 'fs';
import http from 'http';
import https from 'https';
import express from 'express';
import PQueue from 'p-queue';

import {
  PORTS,
  RUNNER_HOST,
  PROXY_PORT
} from './server-constants.mjs';

// Queue

const queue = new PQueue({
	concurrency: 1,
	timeout: 15000,
	throwOnTimeout: true
});

queue.on('active', () => {
	console.log(`Working on request.  Size: ${queue.size}  Pending: ${queue.pending}`);
});

// End Queue

const _proxyUrl = (req, res, url, {
  rewriteHost = false,
} = {}) => {
  const {method} = req;
  const opts = {
    method,
  };

  const proxyReq = /^https:/.test(url)
    ? https.request(url, opts)
    : http.request(url, opts);

  for (const header in req.headers) {
    if (!rewriteHost || !['host'].includes(header.toLowerCase())) {
      proxyReq.setHeader(header, req.headers[header]);
    }
  }

  proxyReq.on('response', proxyRes => {
    for (const header in proxyRes.headers) {
      res.setHeader(header, proxyRes.headers[header]);
    }
    res.statusCode = proxyRes.statusCode;
    proxyRes.pipe(res);
  });

  proxyReq.on('error', err => {
    console.error(err);
    res.statusCode = 500;
    res.end();
  });

  if (['POST', 'PUT', 'DELETE'].includes(method)) {
    req.pipe(proxyReq);
  } else {
    proxyReq.end();
  }
};

//

const isProduction = process.env.NODE_ENV === 'production';
const vercelJson = JSON.parse(fs.readFileSync('./vercel.json', 'utf8'));

const {headers: headerSpecs} = vercelJson;
const headerSpec0 = headerSpecs[0];
const {headers} = headerSpec0;
const _setHeaders = res => {
  for (const {key, value} of headers) {
    res.setHeader(key, value);
  }
};

const app = express();

const queueAndRun = (req, res, {
  rewriteHost = false,
} = {}) => {
  if (req.url.startsWith('/midasDepth')) {
    _proxyUrl(req, res, `http://${RUNNER_HOST}:${PORTS.MIDASDEPTH}${req.url}`);
  } else if (req.url.startsWith('/zoeDepth')) {
    _proxyUrl(req, res, `http://${RUNNER_HOST}:${PORTS.ZOEDEPTH}${req.url}`);

  } else if (req.url.startsWith('/api/imaginairy/')) {
    const urlAddition = req.url.replace(/^\/api\/imaginairy/, '');
    _proxyUrl(req, res, `http://${RUNNER_HOST}:${PORTS.IMAGE}${urlAddition}`);
  } else if (req.url.startsWith('/api/falcon/')) {
    const u = req.url.replace(/^\/api\/falcon/, '');
    _proxyUrl(req, res, `http://${RUNNER_HOST}:${PORTS.FALCON}${u}`);
  } else if (req.url.startsWith('/api/pygmalion/')) {
    const u = req.url.replace(/^\/api\/pygmalion/, '');
    _proxyUrl(req, res, `http://${RUNNER_HOST}:${PORTS.FASTCHAT}${u}`);
  } else if (['/api/ai/tts'].some(prefix => req.url.startsWith(prefix))) {
    const u = req.url.replace(/^\/api/, '');
    _proxyUrl(req, res, `http://${RUNNER_HOST}:${PORTS.TTS}${u}`);

  } else if (['/api/depth/'].some(prefix => req.url.startsWith(prefix))) {
    const url = req.url.replace(/^\/api\/depth/, '');
    _proxyUrl(req, res, `http://${RUNNER_HOST}:${PORTS.DEPTH}${url}`);

  } else if (
    ['/api/mask2former/'].some(prefix => req.url.startsWith(prefix))
  ) {
    const url = req.url.replace(/\/api\/mask2former/, '');
    _proxyUrl(req, res, `http://${RUNNER_HOST}:${PORTS.MASK2FORMER}${url}`);
    
  } else if (['/api/ocr'].some(prefix => req.url.startsWith(prefix))) {
    const url = req.url.replace(/\/api/, '');
    _proxyUrl(req, res, `http://${RUNNER_HOST}:${PORTS.DOCTR}${url}`);
  } else if (['/api/caption', '/api/vqa'].some(prefix => req.url.startsWith(prefix))) {
    const url = req.url.replace(/\/api/, '');
    _proxyUrl(req, res, `http://${RUNNER_HOST}:${PORTS.BLIP2}${url}`);
  
  } else if (['/api/imageSegmentation/'].some(prefix => req.url.startsWith(prefix))) {
    const url = req.url.replace(/\/api\/imageSegmentation/, '');
    _proxyUrl(req, res, `http://${RUNNER_HOST}:${PORTS.SEGMENTATION}${url}`);

  } else if (['/api/irn/'].some(prefix => req.url.startsWith(prefix))) {
    const url = req.url.replace(/^\/api\/irn/, '');
    _proxyUrl(req, res, `https://local.webaverse.com:${PORTS.IRN}${url}`);
  } else if (
    [
      '/api/ai/',
      // '/api/image-ai/',
      // '/api/chat/completions',
      // '/api/audio/transcriptions',
      // '/api/voice/',
    ].some(prefix => req.url.startsWith(prefix))
  ) {
    // await aiServer.handleRequest(req, res);
    const url = req.url;
    _proxyUrl(req, res, `http://${RUNNER_HOST}:${PORTS.AI_SERVER}${url}`);
  } else {
    res.status(404);
    res.end('not found');
  }
}

const handleRequest = async (req, res, next) => {
  _setHeaders(res);

  console.log('got req url', req.url);

  // AI
  
  if (req.method === 'OPTIONS') {
    res.end();
  }

  let shouldCancel = false;

  req.on('end', () => {
    try {
      tokenCheckQueue.add(async () => {
        if (shouldCancel === false) {
          queueAndRun(req, res);
        } else {
          console.warn('skipping job start because request is cancelled')
        }
      });
    } catch (err) {
      console.warn(err.stack);
      res.status(500);
      res.end();
    }
  });

  req.on('close', () => {
    shouldCancel = true;
  });
};
app.all('*', handleRequest);

//

const port = process.env.PORT || PROXY_PORT;

//

const httpServer = http.createServer(app);
httpServer.on('upgrade', (req, socket, head) => {
  multiplayerProxy.ws(req, socket, head);
});
httpServer.listen(port, '0.0.0.0', () => {
  console.log(`ready listening on http://127.0.0.1:${port}`);
});

//

process.on('uncaughtException', (err) => {
  console.log('dev-server uncaughtException', err.stack);
  // process.exit();
});
process.on('unhandledRejection', (err) => {
  console.log('dev-server unhandledRejection', err.stack);
  // process.exit();
});
