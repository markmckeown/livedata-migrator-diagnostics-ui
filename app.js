//
// Copyright © WANDisco 2021-2022
//
// Author: Mark Mc Keown, Colm Dougan, Michal Dobisek
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
const express = require('express');
const app = express();
const gzip = require('zlib');
const fs = require('fs');
const JSONStream = require("JSONStream");
const lz4 = require('lz4');
const path = require('path');
const MD5 = require("crypto-js/md5");

const workspace = 'workspace'
const hostname = '127.0.0.1';
const port = process.argv[3] ? parseInt(process.argv[3]) : 3000;
// Content returned by APIs is static, set cache control to 5 minutes.
const cache_max_age = 300;
app.use(express.static('public'));

var firstTimeStamp;
var lastTimeStamp;
// Use the hardcoded sample file or the first command line after the "node app.js" as the
// the file
//    node app.js foo
// will open foo.
// TODO - Add API + HTML to upload file.
const filepath = path.resolve(process.argv.slice(2)[0] ? process.argv.slice(2)[0] : 'diagnostics.log.formatted');
console.log("Using filepath: ", filepath);
const filename = path.basename(filepath);
console.log("filename: ", filename);


// Helper for summaryUpdate, extracts the connection totals
function getConnectionTotals(connectionTotals) {
  let totalRxQueue = 0;
  let totalTxQueue = 0;
  let retrnsmt = 0;
  for (let connectionTotal in connectionTotals) {
    totalRxQueue = totalRxQueue + connectionTotals[connectionTotal].totalRxQueue;
    totalTxQueue = totalTxQueue + connectionTotals[connectionTotal].totalTxQueue;
    retrnsmt = retrnsmt + connectionTotals[connectionTotal].retrnsmt;
  } 
  return {totalRxQueue, totalTxQueue, retrnsmt}
}

// As the diagnostics are streamed in capture a summary
// of the data, essentially a time sequence.
function updateSummary(json, summary) {
   summary.timeStamp.push(json.timeStamp);
   // There can be multiple ActionStore diagnostics, one for
   // each migration so they need to be summed up.
   let actionStoreFoundCount = 0;
   for(let i in json.diagnostics) {
      let diagnostic = json.diagnostics[i];
      // TODO - use switch
      if (diagnostic.type === 'ThroughputDiagnosticDTO') {
        summary.bytesPerSecond.push(diagnostic.bytesMigrated/diagnostic.period);
        summary.filesForPeriod.push(diagnostic.filesMigrated);
        summary.filesPerSecond.push(diagnostic.filesMigrated/diagnostic.period);
        continue;
      } 
      if (diagnostic.type === 'LinuxPressureDiagnosticDTO') {
        summary.ioWaitPercentage.push(diagnostic.iowaitPercentage);
        continue;
      }
      if (diagnostic.type === 'NetworkStatusDTO') {
        summary.connectionCount.push(diagnostic.connections.length);
        let totals = getConnectionTotals(diagnostic.connectionTotals);        
        summary.totalRxQueue.push(totals.totalRxQueue);
        summary.totalTxQueue.push(totals.totalTxQueue);
        summary.retrnsmt.push(totals.retrnsmt);
        continue;
      } 
      if (diagnostic.type === 'MigrationDiagnosticDTO') {
        if (!diagnostic.hasOwnProperty('totalPendingRegions')) {
          let totalPendingRegions = 0;
          for (let i in diagnostic.pendingRegions) {
             totalPendingRegions += diagnostic.pendingRegions[i];
          }
          diagnostic.totalPendingRegions = totalPendingRegions;
        }
        summary.pendingRegions.push(diagnostic.totalPendingRegions);
        if (!diagnostic.hasOwnProperty('totalFailedPaths')) {
          let totalFailedPaths = 0;
          for (let i in diagnostic.failedPaths) {
            totalFailedPaths += diagnostic.failedPaths[i];
          }
          diagnostic.totalFailedPaths = totalFailedPaths;
        }
        summary.failedPaths.push(diagnostic.totalFailedPaths);
        if (!diagnostic.hasOwnProperty('totalPathRetryCount')) {
          let totalPathRetryCount = 0;
          for (let i  in diagnostic.pathRetryCount) {
            totalPathRetryCount += diagnostic.pathRetryCount[i];
          }
          diagnostic.totalPathRetryCount = totalPathRetryCount;
        }
        summary.retries.push(diagnostic.totalPathRetryCount);  
        continue;
      }
      if (diagnostic.type === 'EventManagerDiagnosticDTO') {
        summary.events.push(diagnostic.totalQueuedEvents);
	summary.eventManagerMeanDbTime.push(diagnostic.meanDbTime);
        summary.eventManagerMaxDbTime.push(diagnostic.maxDbTime);	      
        continue;
      }
      if (diagnostic.type === 'ActionStoreDiagnosticDTO') {
        actionStoreFoundCount += diagnostic.totalUnExecutedEvents;
        continue;
      }
      if (diagnostic.type === 'CpuLoadDiagnosticDTO') {
        summary.systemCpuLoad.push(diagnostic.systemCpuLoad);
        summary.processCpuLoad.push(diagnostic.processCpuLoad);
        continue;
      }
      if (diagnostic.type === 'JvmGcDiagnosticDTO') {
        summary.gcAverageTime.push(diagnostic.gcPauseTime/diagnostic.gcCount);
        if (summary.previousGCTime == 0) {
          // restart
          summary.gcTimeForPeriod.push(0);
        } else {
          summary.gcTimeForPeriod.push(diagnostic.gcPauseTime - summary.previousGCTime);
        }
        summary.previousGCTime = diagnostic.gcPauseTime;
        continue;
      }
      if (diagnostic.type === 'FileTrackerDiagnosticDTO') {
        summary.filetrackerCount.push(diagnostic.fileTrackers.length);
        continue;
      }
   }
   summary.actions.push(actionStoreFoundCount); 
}


function getWorkspaceDir(filePath) {
  const filename = path.basename(filepath);

  return workspace + '/' + filename + '-' + MD5(filepath);
}

function mkdirWorkSpaceDir(filepath) {
 // create a directory to store the indexed diagnostics.
 if (!fs.existsSync(workspace)) {
   fs.mkdirSync(workspace);
 }
 let pathForDir = getWorkspaceDir(filepath);
 if (!fs.existsSync(pathForDir)) {
   fs.mkdirSync(pathForDir);
  }

  for (let i=0; i < 256; i++) {
    let subPath = pathForDir + '/' + i;
    if (!fs.existsSync(subPath)) {
      fs.mkdirSync(subPath);
    }
  }
  return pathForDir;
}



function workSpacePathForDiagnostic(filepath, index) {
   return getWorkspaceDir(filepath) + '/' + index % 256 + '/' + index + '.gz';
}

function getSummaryPath(filepath) {
   return getWorkspaceDir(filepath) + '/summary.lz4';
}

function getReportsFile(filename, reportName) {
   return getWorkspaceDir(filepath) + '/' + reportName+ '.gz';
}

// Read the diagnostics as a stream, capture
// a summary in memory and then log each
// diagnostic into a compressed file that is indexed
// by its order in the stream
async function readDiagnostics(filepath, filename) {
  let summary = {
    timeStamp : [],
    bytesPerSecond : [],
    filesForPeriod : [],
    filesPerSecond : [],
    ioWaitPercentage : [],
    connectionCount : [],
    totalRxQueue : [],
    totalTxQueue : [],
    retrnsmt : [],
    pendingRegions : [],
    events : [],
    actions : [],
    failedPaths : [],
    retries : [],
    processCpuLoad : [],
    systemCpuLoad : [],
    gcAverageTime : [],
    gcTimeForPeriod : [],
    previousGCTime : 0,
    filetrackerCount : [],
    eventManagerMeanDbTime : [],
    eventManagerMaxDbTime : []
  }; 
  
  return new Promise(function(resolve,reject){
    let i = 0;
    if (fs.existsSync(getSummaryPath(filepath))) {
      console.log('Summary file found for ', filename);
      summary = JSON.parse(lz4.decode(fs.readFileSync(getSummaryPath(filepath)))); 
      firstTimeStamp = summary.timeStamp[0]; 
      lastTimeStamp = summary.timeStamp[summary.timeStamp.length - 1]; 
      resolve(summary.timeStamp.length);
      return;
    }
 
    let workspaceDir = mkdirWorkSpaceDir(filepath);
 
    let stream;
    if (filename.endsWith('.gz')) {
       stream = fs.createReadStream(filepath).pipe(gzip.createGunzip());
    } else {
       stream = fs.createReadStream(filepath, { encoding: "utf8" });
    }

    // Stream the diagnostics, parse the JSON into diagnostics
    // - write each diagnostic to disk compressed and capture
    // a summary.
    stream.pipe(JSONStream.parse("*"))
      .on('data', function(data) {
         // This could be async?
         // Dump the individual DiagnosticSet to a file with the index
         // as file name, compressed with lz4.
         updateSummary(data, summary);
         writeDiagnostic(workSpacePathForDiagnostic(filepath, data.timeStamp), data);
         i++;
       })
      .on('end', () => {
         writeReports(filepath, summary);
         fs.writeFileSync(getSummaryPath(filepath), lz4.encode(JSON.stringify(summary)));
         firstTimeStamp = summary.timeStamp[0]; 
         lastTimeStamp = summary.timeStamp[summary.timeStamp.length - 1]; 
         resolve(i);
       })
      .on('error', reject); 
    }); 
}


function writeReports(filepath, summary) {
   let functionMap = {
     'thoughput' : getThroughPutDiagnostics,
     'iowaitpercentage' : getIoWaitPercentage,
     'systemCPU' : getSystemCPUDiagnostics,
     'jvmGC' : getJvmGCTimeDiagnostics,
     'network' : getNetworkDiagnostics,
     'queues' : getQueueDiagnostics,
     'filetrackers' : getFileTrackers,
     'db_diagnostics' : eventManagerDBdiagnostics,
     'migration_failures' : getMigrationDiagnostics
   } 

   for (let [file, fn] of Object.entries(functionMap)) {
     let stream = gzip.createGzip();
     stream.pipe(fs.createWriteStream(getReportsFile(filepath, file)));
     stream.write(JSON.stringify(fn(summary)), 'utf-8');
     stream.end();
   }
}


function setHeaders(res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Encoding', 'gzip');
  res.setHeader('Cache-Control', 'max-age=' + cache_max_age);
}

// API Endpoints
app.get('/api/throughput', (req, res) => {
  res.statusCode = 200;
  setHeaders(res);
  fs.createReadStream(getReportsFile(filename,'thoughput')).pipe(res);
})

app.get('/api/iowaitpercentage', (req, res) => {
  res.statusCode = 200;
  setHeaders(res);
  fs.createReadStream(getReportsFile(filename,'iowaitpercentage')).pipe(res);
})

app.get('/api/systemCPU', (req, res) => {
  res.statusCode = 200;
  setHeaders(res);
  fs.createReadStream(getReportsFile(filename,'systemCPU')).pipe(res);
})

app.get('/api/jvmGC', (req, res) => {
  res.statusCode = 200;
  setHeaders(res);
  fs.createReadStream(getReportsFile(filename,'jvmGC')).pipe(res);
})

app.get('/api/network', (req, res) => {
  res.statusCode = 200;
  setHeaders(res);
  fs.createReadStream(getReportsFile(filename,'network')).pipe(res);
})

app.get('/api/queues', (req, res) => {
  res.statusCode = 200;
  setHeaders(res);
  fs.createReadStream(getReportsFile(filename,'queues')).pipe(res);
})

app.get('/api/diagnostic', (req, res) => {
  res.statusCode = 200;
  setHeaders(res);
  fs.createReadStream(getDiagnosticFileName(req.query.index)).pipe(res);
})

app.get('/api/filetrackers', (req, res) => {
  res.statusCode = 200;
  setHeaders(res);
  fs.createReadStream(getReportsFile(filename,'filetrackers')).pipe(res);
})

app.get('/api/event_manager/db_diagnostics', (req, res) => {
  res.statusCode = 200;
  setHeaders(res);
  fs.createReadStream(getReportsFile(filename,'db_diagnostics')).pipe(res);
})

app.get('/api/migration_failures', (req, res) => {
  res.statusCode = 200;
  setHeaders(res);
  fs.createReadStream(getReportsFile(filename,'migration_failures')).pipe(res);
})


function writeDiagnostic(filename, data) {
   stream = gzip.createGzip();
   stream.pipe(fs.createWriteStream(filename));
   stream.write(JSON.stringify({diagnosticSet : data}), 'utf-8');
   stream.end();
}

function getDiagnosticFileName(query_index) {
  let index = query_index ? query_index : firstTimeStamp;
  index = index > 0 ? index : firstTimeStamp;   
  return workSpacePathForDiagnostic(filepath, index);
}


function getFileTrackers(summary) {
  let timeStamp = summary.timeStamp;
  let filetrackerCount = summary.filetrackerCount;
  let bytesPerSecond = summary.bytesPerSecond; 	
  return {timeStamp, filetrackerCount, bytesPerSecond}
}

function getJvmGCTimeDiagnostics(summary) {
  let timeStamp = summary.timeStamp;
  let gcTimeForPeriod = summary.gcTimeForPeriod;
  let gcAverageTime = summary.gcAverageTime;
  return {timeStamp, gcTimeForPeriod, gcAverageTime}
}

function getSystemCPUDiagnostics(summary) {
  let timeStamp = summary.timeStamp;
  let processCpuLoad = summary.processCpuLoad;
  let systemCpuLoad = summary.systemCpuLoad;
  return {timeStamp, processCpuLoad, systemCpuLoad}
}

function getMigrationDiagnostics(summary) {
  let timeStamp = summary.timeStamp;
  let failedPaths = summary.failedPaths;
  let retries = summary.retries;
  return {timeStamp, failedPaths, retries}
}


function eventManagerDBdiagnostics(summary) {
  let timeStamp = summary.timeStamp;
  let eventManagerMeanDbTime = summary.eventManagerMeanDbTime;
  let eventManagerMaxDbTime = summary.eventManagerMaxDbTime;
  return {timeStamp, eventManagerMeanDbTime, eventManagerMaxDbTime}
}

function getQueueDiagnostics(summary) {
  let timeStamp = summary.timeStamp;
  let pendingRegions = summary.pendingRegions;
  let events = summary.events;
  let actions = summary.actions;
  return {timeStamp, pendingRegions, events, actions}
}

function getNetworkDiagnostics(summary) {
  let timeStamp = summary.timeStamp;
  let connectionCount = summary.connectionCount;
  let totalRxQueue = summary.totalRxQueue;
  let totalTxQueue = summary.totalTxQueue;
  let retrnsmt = summary.retrnsmt;
  let bytesPerSecond = summary.bytesPerSecond;
  return {timeStamp, connectionCount, totalRxQueue, totalTxQueue, retrnsmt, bytesPerSecond};
}

function getIoWaitPercentage(summary) {
  let timeStamp = summary.timeStamp;
  let ioWaitPercentage = summary.ioWaitPercentage;
  return {timeStamp, ioWaitPercentage}
}

function getThroughPutDiagnostics(summary) {
  let timeStamp = summary.timeStamp;
  let bytesPerSecond = summary.bytesPerSecond;
  let filesForPeriod = summary.filesForPeriod;
  let filesPerSecond = summary.filesPerSecond;
  return {timeStamp, bytesPerSecond, filesForPeriod, filesPerSecond}
}

// Read in and process the diagnostics, and then
// start listening for connection.
readDiagnostics(filepath, filename).then(function(value) {
   console.log("diagnostics read: ", value);
   app.listen(port, () => {
      console.log(`Example app listening on port ${port}`)
   });
});
