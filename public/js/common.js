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


function transparentize(r, g, b, alpha) {
  const a = (1 - alpha) * 255;
  const calc = x => Math.round((x - a)/alpha);
  return `rgba(${calc(r)}, ${calc(g)}, ${calc(b)}, ${alpha})`;
}

function toDate(value, index, array) {
  return new Date(value).toISOString().slice(0, -5);
}

function toTime(value, index, array) {
  return new Date(value).toISOString().replace('T', ' ').substring(0, 19).split(' ')[1];
}

function toMBSecond(value, index, array) {
  return Math.floor((value * 8)/(1000 * 1000))
}

function toMBDecimal(value, index, array) {
  return ((value * 8.0)/(1000 * 1000))
}

function msToTime(s) {
  // Pad to 2 or 3 digits, default is 2
  function pad(n, z) {
    z = z || 2;
    return ('00' + n).slice(-z);
  }

  var ms = s % 1000;
  s = (s - ms) / 1000;
  var secs = s % 60;
  s = (s - secs) / 60;
  var mins = s % 60;
  var hrs = (s - mins) / 60;

  return pad(hrs) + ':' + pad(mins) + ':' + pad(secs) + '.' + pad(ms, 3);
}

function secondsToTime(s) {
  // Pad to 2 or 3 digits, default is 2
  function pad(n, z) {
    z = z || 2;
    return ('00' + n).slice(-z);
  }

  var secs = s % 60;
  s = (s - secs) / 60;
  var mins = s % 60;
  var hrs = (s - mins) / 60;

  return pad(hrs) + ':' + pad(mins) + ':' + pad(secs);
}

function humanFileSize(bytes, si=false, dp=1) {
  const thresh = si ? 1000 : 1024;

  if (Math.abs(bytes) < thresh) {
    return bytes + ' B';
  }

  const units = si 
    ? ['kB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'] 
    : ['KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB', 'ZiB', 'YiB'];
  let u = -1;
  const r = 10**dp;

  do {
    bytes /= thresh;
    ++u;
  } while (Math.round(Math.abs(bytes) * r) / r >= thresh && u < units.length - 1);


  return bytes.toFixed(dp) + ' ' + units[u];
}


function getPsValue(p, list) {
  if (p === 0) return list[0];
  let kIndex = Math.ceil(list.length * (p / 100)) - 1;
  return list[kIndex];
}

function percentile(pOrPs, list) {
  let ps = Array.isArray(pOrPs) ? pOrPs : [pOrPs];

  list = list.slice().sort(function (a, b) {
    a = Number.isNaN(a) ? Number.NEGATIVE_INFINITY : a;
    b = Number.isNaN(b) ? Number.NEGATIVE_INFINITY : b;

    if (a > b) return 1;
    if (a < b) return -1;

    return 0;
  });

  if (ps.length === 1) {
    return getPsValue(ps[0], list);
  }

  return ps.map(function (p) {
    return getPsValue(p, list);
  });
}

function copyLink(link) {
  let myurl = window.location.href;
  var subUrl = myurl.substring(0,myurl.lastIndexOf("/") + 1);
  return shareLink(subUrl + link);
}

function shareLink(shareLink) {

  // Copy the text inside the text field
  navigator.clipboard.writeText(shareLink).then(() => {
     alert("URL copied to clipboard: " + shareLink);
  });
}

var g_sortingPageId = null;
var g_localSorting = null;

function getQueryBase() {
    let startTimestamp =  diagnosticsTimeSeries.timeStamps[diagnosticsTimeSeries.datesIndexMap[diagnosticsTimeSeries.start]]
    let middleTimestamp = diagnosticsTimeSeries.timeStamps[diagnosticsTimeSeries.datesIndexMap[diagnosticsTimeSeries.middle]] 
    let endTimestamp = diagnosticsTimeSeries.timeStamps[diagnosticsTimeSeries.datesIndexMap[diagnosticsTimeSeries.end]]
    let query = "?start=" + startTimestamp + "&middle=" + middleTimestamp + "&end=" + endTimestamp;

    let sortBy = buildSortBy(g_sortingPageId);
    if (sortBy) {
      query = query + "&sortBy=" + sortBy;
    }

    return query;
}

function getMySorting(pageId) {
  // any sorting on the current page wins
  if (g_localSorting !== null) {
    return g_localSorting;
  }

  let sortBy = getSortByFromQueryParameter();
  return sortBy[pageId];
}

function getSortByFromQueryParameter() {
  const urlParams = new URLSearchParams(window.location.search);
  let sortByEncoded = urlParams.get('sortBy');

  let sortBy = {};
  if (sortByEncoded) {
    let elems = sortByEncoded.split(",");
    for (let i = 0; i < elems.length; i++) {
      var vals = elems[i].split(':');
      sortBy[vals[0]] = parseInt(vals[1]);
    }
  }

  return sortBy;
}

function encodeSortBy(sortBy) {
  let encoded = "";

  for (const [key, val] of Object.entries(sortBy)) {
    if (encoded) {
      encoded += ",";
    }

    encoded = encoded + key + ":" + val;
  }

  return encoded;
}

function buildSortBy(myId) {
  let sortBy = getSortByFromQueryParameter();

  if (myId) {
    // any sorting on the current page wins
    if (g_localSorting !== null) {
      sortBy[myId] = g_localSorting;
    }
  }

  return encodeSortBy(sortBy);
}

function makeSortable(pageId, s, newTableObject) {
  g_sortingPageId = pageId;

  s.attachOnSorted(function(colIndex) {
    var sortedAsc = document.getElementsByClassName("sorttable_sorted")[0];
    if (sortedAsc) {
      g_localSorting = sortedAsc.cellIndex;
    }

    // assuming this won't coexist wih the above
    var sortedDesc = document.getElementsByClassName("sorttable_sorted_reverse")[0];
    if (sortedDesc) {
      g_localSorting = sortedDesc.cellIndex * -1;
    }

    reWriteLinks();
  });

  s.makeSortable(newTableObject);

  let mySorting = getMySorting(pageId);
  if (typeof mySorting !== "undefined") {
    //var myTH = document.getElementsByTagName("th")[sortBy];
    var sortIndex = Math.abs(mySorting);
    var myTH = newTableObject.getElementsByTagName("th")[sortIndex];
    sorttable.innerSortFunction.apply(myTH, []);

    // trigger again to flip the ordering
    // XXX: is there some better way to do this?
    if (mySorting < 0) {
      sorttable.innerSortFunction.apply(myTH, []);
    }
  }
}

function getIndexLink() {
   return "index.html" + getQueryBase();
}

function getThroughputLink() {
   return "throughput.html" + getQueryBase();
}

function getSystemLink() {
   return "system.html" + getQueryBase();
}

function getFileTrackerLink() {
   return "filetrackers.html" + getQueryBase();
}

function getFileLink(file) {
   return "transfer.html" + getQueryBase() + "&path=" + encodeURIComponent(file);
}

function getMigrationsLink() {
   return "migrations.html" + getQueryBase();
}

function getMigrationLink(migration_name) {
   return "migration.html" + getQueryBase() + "&migration=" + encodeURIComponent(migration_name);
}

function getNetworkLink() {
   return "network.html" + getQueryBase();
}

function getEventStreamLink() {
   return "eventstream.html" + getQueryBase();
}

function reWriteLinks() {
    document.getElementById('index-link').href = getIndexLink();
    document.getElementById('throughput-link').href = getThroughputLink();
    document.getElementById('system-link').href = getSystemLink();
    document.getElementById('filetrackers-link').href = getFileTrackerLink();
    document.getElementById('migrations-link').href = getMigrationsLink();
    document.getElementById('network-link').href = getNetworkLink();
    document.getElementById('eventstream-link').href = getEventStreamLink();
}


async function loadDiagnostic(ts) {
  if (ts == -1) {
    return await _loadJsonResource(_timestampToShardedDataPath(diagnostic_ui_config.firstTimeStamp));
  }

  return await _loadJsonResource(_timestampToShardedDataPath(ts));
}

async function loadReport(reportName) {
  return await _loadJsonResource(reportName);
}

async function _loadJsonResource(path) {
  try {
    let res = await fetch('data/' + path);
    let json = await res.json();
    return json;
  } catch (error) {
    console.log(error);
  }
}

function _timestampToShardedDataPath(ts) {
  return new Date(ts).toISOString().substr(0, 10) + '/' + ts + ".gz";
}

const diagnosticsTimeSeries = {
  diagnosticTimeStamp: 0,
  start: 0,
  middle: 0,
  end: 0,
  dates: [],
  timeStamps: [],
  datesIndexMap: {},
  timeStampMap: {},
}; 

function renderSlider(slider, onUpdate, onChange) {
   var format = {
      to: function(value) {
        return diagnosticsTimeSeries.dates[Math.round(value)];
      },
      from: function (value) {
        return diagnosticsTimeSeries.datesIndexMap[value];
      }
   };

   noUiSlider.create(slider, {
      start: [diagnosticsTimeSeries.start, 
              diagnosticsTimeSeries.middle, 
              diagnosticsTimeSeries.end],
      connect: [false, true, true, false],
      behaviour: 'drag-all-tap',
      tooltips: true,
      step: 1,
      range: { 
          min: 0, 
          max: diagnosticsTimeSeries.dates.length - 1 
      },
      format: format,
      pips: {
         mode: 'range',
         density: 4,
         format: format,
      }
    });

    slider.noUiSlider.on('update', function () {
        let values = slider.noUiSlider.get();
        diagnosticsTimeSeries.start = values[0];
        diagnosticsTimeSeries.middle = values[1];
        diagnosticsTimeSeries.end = values[2];
        onUpdate();
    });

    slider.noUiSlider.on('change', function () {
        let values = slider.noUiSlider.get();
        diagnosticsTimeSeries.middle = values[1];
        diagnosticsTimeSeries.start = values[0];
        diagnosticsTimeSeries.end = values[2];
        onChange();
    });

    var connect = slider.querySelectorAll('.noUi-connect');
    connect[0].classList.add('c-1-color');
    connect[1].classList.add('c-1-color');
    mergeTooltips(slider, 15, ' - ');
    return;
}


function getPageDateRange() {
   const urlParams = new URLSearchParams(window.location.search);
   let pageStart = urlParams.get('start');
   if (pageStart) {
       pageStart = parseInt(pageStart);
   } else {
       pageStart = -1;
   }
   let pageMiddle = urlParams.get('middle');
   if (pageMiddle) {
       pageMiddle = parseInt(pageMiddle);
   } else {
       pageMiddle = -1;
   }       
   let pageEnd = urlParams.get('end');
   if (pageEnd) {
       pageEnd = parseInt(pageEnd);
   } else {
       pageEnd = -1;
   }
   return [pageStart, pageMiddle, pageEnd];
}


function getDefaultDateRange(timeStampMap, dates) {
   // If less than 1 day return the full range.
   if (diagnosticsTimeSeries.dates.length < 1440) {
      return [diagnosticsTimeSeries.dates[0], 
              diagnosticsTimeSeries.dates[Math.floor(diagnosticsTimeSeries.dates.length/2)],
              diagnosticsTimeSeries.dates[diagnosticsTimeSeries.dates.length - 1]]
   }
   
   return [diagnosticsTimeSeries.dates[0],
           diagnosticsTimeSeries.dates[1440/2],
           diagnosticsTimeSeries.dates[1440-1]];
}


function initialiseDateRange(timeStampMap, dates) {
   const [pageStart, pageMiddle, pageEnd] = getPageDateRange();

   if (pageStart === -1 || pageMiddle === -1 || pageEnd === -1) {
      return getDefaultDateRange(timeStampMap, dates);
   }

   if (!(pageStart in timeStampMap) || 
        !(pageMiddle in timeStampMap) ||
          !(pageEnd in timeStampMap)) {
      return getDefaultDateRange(timeStampMap, dates);
   }

   return [dates[timeStampMap[pageStart]],
           dates[timeStampMap[pageMiddle]],
           dates[timeStampMap[pageEnd]]];
}



function generateDiagnosticTimeSeries(timeStamps) {
    diagnosticsTimeSeries.timeStamps = timeStamps;
    diagnosticsTimeSeries.dates = diagnosticsTimeSeries.timeStamps.map(toDate);
    let i = 0;
    while (i < diagnosticsTimeSeries.dates.length) {
       if (diagnosticsTimeSeries.dates[i] in diagnosticsTimeSeries.datesIndexMap) {
          console.log(diagnosticsTimeSeries.dates[i] +  " already mapped")
       }
       diagnosticsTimeSeries.datesIndexMap[diagnosticsTimeSeries.dates[i]] = i;
       diagnosticsTimeSeries.timeStampMap[diagnosticsTimeSeries.timeStamps[i]] = i;
       i++;
    }
    range = initialiseDateRange(diagnosticsTimeSeries.timeStampMap, 
                                diagnosticsTimeSeries.dates);
    diagnosticsTimeSeries.start = range[0];
    diagnosticsTimeSeries.middle = range[1];
    diagnosticsTimeSeries.end = range[2];
}


function mergeTooltips(slider, threshold, separator) {

    var textIsRtl = getComputedStyle(slider).direction === 'rtl';
    var isRtl = slider.noUiSlider.options.direction === 'rtl';
    var isVertical = slider.noUiSlider.options.orientation === 'vertical';
    var tooltips = slider.noUiSlider.getTooltips();
    var origins = slider.noUiSlider.getOrigins();

    // Move tooltips into the origin element. The default stylesheet handles this.
    tooltips.forEach(function (tooltip, index) {
        if (tooltip) {
            origins[index].appendChild(tooltip);
        }
    });

    slider.noUiSlider.on('update', function (values, handle, unencoded, tap, positions) {

        var pools = [[]];
        var poolPositions = [[]];
        var poolValues = [[]];
        var atPool = 0;

        // Assign the first tooltip to the first pool, if the tooltip is configured
        if (tooltips[0]) {
            pools[0][0] = 0;
            poolPositions[0][0] = positions[0];
            poolValues[0][0] = values[0];
        }

        for (var i = 1; i < positions.length; i++) {
            if (!tooltips[i] || (positions[i] - positions[i - 1]) > threshold) {
                atPool++;
                pools[atPool] = [];
                poolValues[atPool] = [];
                poolPositions[atPool] = [];
            }

            if (tooltips[i]) {
                pools[atPool].push(i);
                poolValues[atPool].push(values[i]);
                poolPositions[atPool].push(positions[i]);
            }
        }

        pools.forEach(function (pool, poolIndex) {
            var handlesInPool = pool.length;

            for (var j = 0; j < handlesInPool; j++) {
                var handleNumber = pool[j];

                if (j === handlesInPool - 1) {
                    var offset = 0;

                    poolPositions[poolIndex].forEach(function (value) {
                        offset += 1000 - value;
                    });

                    var direction = isVertical ? 'bottom' : 'right';
                    var last = isRtl ? 0 : handlesInPool - 1;
                    var lastOffset = 1000 - poolPositions[poolIndex][last];
                    offset = (textIsRtl && !isVertical ? 100 : 0) + (offset / handlesInPool) - lastOffset;

                    // Center this tooltip over the affected handles
                    tooltips[handleNumber].innerHTML = poolValues[poolIndex].join(separator);
                    tooltips[handleNumber].style.display = 'block';
                    tooltips[handleNumber].style[direction] = offset + '%';
                } else {
                    // Hide this tooltip
                    tooltips[handleNumber].style.display = 'none';
                }
            }
        });
    });
}


// Each time we load a diagnostic we rebuild this map - 
// we may actually remember Ids that are not in the current
// diagnostic.
var migrationIdMap = {}
var migrationNameMap = {}
function buildMigrationIdMap(diagnostics) {
  for (let i in diagnostics) {
      if (diagnostics[i].type === 'ActionStoreDiagnosticDTO') {
          migrationIdMap[diagnostics[i].id] = diagnostics[i].migrationId;
          migrationNameMap[diagnostics[i].migrationId] = diagnostics[i].id;
      }
  }
}


function getCurrentTransferPercentiles(diagnosticSet) {
  let diagnostic;
  for (let i in diagnosticSet.diagnostics) {
    diagnostic = diagnosticSet.diagnostics[i];
    if (diagnostic.type === 'FileTrackerDiagnosticDTO') {
      break;
    }
  }
  let fileTrackers = diagnostic.fileTrackers;

  let size = [];
  let rate = [];
  let latency = [];
  let count = 0;
  let fileTrackerMigrationMap = new Map();
  for (let j in fileTrackers) {
    let fileTracker = fileTrackers[j];
    size.push(fileTracker.FileLength);
    rate.push(fileTracker.BytesPerSecond);
    latency.push(fileTracker.EventLatency);
    if (fileTrackerMigrationMap.has(fileTracker.MigrationId)) {
      fileTrackerMigrationMap.set(fileTracker.MigrationId, fileTrackerMigrationMap.get(fileTracker.MigrationId) + 1);
    } else {
      fileTrackerMigrationMap.set(fileTracker.MigrationId, 1);
    }
    count = count + 1;
  }
  fileTrackerMigrationMapKeys = [];
  fileTrackerMigrationMapValues = [];
  fileTrackerMigrationMapSorted = new Map([...fileTrackerMigrationMap.entries()].sort((a, b) => b[1] - a[1]));
  fileTrackerMigrationMapSorted.forEach(function(value, key) {
    fileTrackerMigrationMapKeys.push(key);
    fileTrackerMigrationMapValues.push(value);
  })

  let fileTrackerPercentileRange = [];
  for (var i=1; i <= 100; i += 1){
    fileTrackerPercentileRange.push(i);
  }
  fileTrackersSizePercentiles = percentile(fileTrackerPercentileRange, size);
  fileTrackersRatePercentiles = percentile(fileTrackerPercentileRange, rate);
  fileTrackersLatencyPercentiles = percentile(fileTrackerPercentileRange, latency);
  return {count, fileTrackerPercentileRange, fileTrackersSizePercentiles, fileTrackersRatePercentiles, fileTrackersLatencyPercentiles, fileTrackerMigrationMapKeys, fileTrackerMigrationMapValues }
}

