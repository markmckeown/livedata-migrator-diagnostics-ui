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

const transparentize = (r, g, b, alpha) => {
  const a = (1 - alpha) * 255;
  const calc = x => Math.round((x - a) / alpha);
  return `rgba(${calc(r)}, ${calc(g)}, ${calc(b)}, ${alpha})`;
};

const toDate = (value) => new Date(value).toISOString().slice(0, -5);

const toTime = (value) => new Date(value).toISOString().replace('T', ' ').substring(0, 19).split(' ')[1];

const toMBSecond = (value) => Math.floor((value * 8) / (1000 * 1000));

const toMBDecimal = (value) => (value * 8.0) / (1000 * 1000);

const msToTime = (s) => {
  const pad = (n, z = 2) => ('00' + n).slice(-z);
  const ms = s % 1000;
  s = (s - ms) / 1000;
  const secs = s % 60;
  s = (s - secs) / 60;
  const mins = s % 60;
  const hrs = (s - mins) / 60;
  return `${pad(hrs)}:${pad(mins)}:${pad(secs)}.${pad(ms, 3)}`;
};

const secondsToTime = (s) => {
  const pad = (n, z = 2) => ('00' + n).slice(-z);
  const secs = s % 60;
  s = (s - secs) / 60;
  const mins = s % 60;
  const hrs = (s - mins) / 60;
  return `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
};

const humanFileSize = (bytes, si = false, dp = 1) => {
  const thresh = si ? 1000 : 1024;
  if (Math.abs(bytes) < thresh) {
    return `${bytes} B`;
  }
  const units = si 
    ? ['kB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'] 
    : ['KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB', 'ZiB', 'YiB'];
  let u = -1;
  const r = 10 ** dp;
  do {
    bytes /= thresh;
    ++u;
  } while (Math.round(Math.abs(bytes) * r) / r >= thresh && u < units.length - 1);
  return `${bytes.toFixed(dp)} ${units[u]}`;
};

const getPsValue = (p, list) => {
  if (p === 0) return list[0];
  const kIndex = Math.ceil(list.length * (p / 100)) - 1;
  return list[kIndex];
};

const percentile = (pOrPs, list) => {
  const ps = Array.isArray(pOrPs) ? pOrPs : [pOrPs];
  const sortedList = [...list].sort((a, b) => {
    const valA = Number.isNaN(a) ? Number.NEGATIVE_INFINITY : a;
    const valB = Number.isNaN(b) ? Number.NEGATIVE_INFINITY : b;
    return valA - valB;
  });

  if (ps.length === 1) {
    return getPsValue(ps[0], sortedList);
  }
  return ps.map(p => getPsValue(p, sortedList));
};

const copyLink = (link) => {
  const myurl = window.location.href;
  const subUrl = myurl.substring(0, myurl.lastIndexOf("/") + 1);
  return shareLink(subUrl + link);
};

const shareLink = (shareLinkUrl) => {
  navigator.clipboard.writeText(shareLinkUrl).then(() => {
     alert(`URL copied to clipboard: ${shareLinkUrl}`);
  });
};

let g_sortingPageId = null;
let g_localSorting = null;

const getQueryBase = () => {
    const startTimestamp = diagnosticsTimeSeries.timeStamps[diagnosticsTimeSeries.datesIndexMap[diagnosticsTimeSeries.start]];
    const middleTimestamp = diagnosticsTimeSeries.timeStamps[diagnosticsTimeSeries.datesIndexMap[diagnosticsTimeSeries.middle]];
    const endTimestamp = diagnosticsTimeSeries.timeStamps[diagnosticsTimeSeries.datesIndexMap[diagnosticsTimeSeries.end]];
    let query = `?start=${startTimestamp}&middle=${middleTimestamp}&end=${endTimestamp}`;

    const sortBy = buildSortBy(g_sortingPageId);
    if (sortBy) {
      query += `&sortBy=${sortBy}`;
    }
    return query;
};

const getMySorting = (pageId) => {
  if (g_localSorting !== null) {
    return g_localSorting;
  }
  const sortBy = getSortByFromQueryParameter();
  return sortBy[pageId];
};

const getSortByFromQueryParameter = () => {
  const urlParams = new URLSearchParams(window.location.search);
  const sortByEncoded = urlParams.get('sortBy');
  const sortBy = {};
  if (sortByEncoded) {
    const elems = sortByEncoded.split(",");
    for (const elem of elems) {
      const vals = elem.split(':');
      sortBy[vals[0]] = parseInt(vals[1], 10);
    }
  }
  return sortBy;
};

const encodeSortBy = (sortBy) => {
  return Object.entries(sortBy).map(([key, val]) => `${key}:${val}`).join(',');
};

const buildSortBy = (myId) => {
  const sortBy = getSortByFromQueryParameter();
  if (myId && g_localSorting !== null) {
    sortBy[myId] = g_localSorting;
  }
  return encodeSortBy(sortBy);
};

const makeSortable = (pageId, s, newTableObject) => {
  g_sortingPageId = pageId;

  s.attachOnSorted((colIndex) => {
    const sortedAsc = document.querySelector(".sorttable_sorted");
    if (sortedAsc) {
      g_localSorting = sortedAsc.cellIndex;
    }
    const sortedDesc = document.querySelector(".sorttable_sorted_reverse");
    if (sortedDesc) {
      g_localSorting = sortedDesc.cellIndex * -1;
    }
    reWriteLinks();
  });

  s.makeSortable(newTableObject);

  const mySorting = getMySorting(pageId);
  if (mySorting !== undefined) {
    const sortIndex = Math.abs(mySorting);
    const myTH = newTableObject.getElementsByTagName("th")[sortIndex];
    if (myTH && sorttable && sorttable.innerSortFunction) {
      sorttable.innerSortFunction.apply(myTH, []);
      if (mySorting < 0) {
        sorttable.innerSortFunction.apply(myTH, []);
      }
    }
  }
};

const getIndexLink = () => `index.html${getQueryBase()}`;
const getThroughputLink = () => `throughput.html${getQueryBase()}`;
const getSystemLink = () => `system.html${getQueryBase()}`;
const getFileTrackerLink = () => `filetrackers.html${getQueryBase()}`;
const getFileLink = (file) => `transfer.html${getQueryBase()}&path=${encodeURIComponent(file)}`;
const getMigrationsLink = () => `migrations.html${getQueryBase()}`;
const getMigrationLink = (migration_name) => `migration.html${getQueryBase()}&migration=${encodeURIComponent(migration_name)}`;
const getNetworkLink = () => `network.html${getQueryBase()}`;
const getEventStreamLink = () => `eventstream.html${getQueryBase()}`;

const reWriteLinks = () => {
    const setHref = (id, link) => {
      const el = document.getElementById(id);
      if (el) el.href = link;
    };
    setHref('index-link', getIndexLink());
    setHref('throughput-link', getThroughputLink());
    setHref('system-link', getSystemLink());
    setHref('filetrackers-link', getFileTrackerLink());
    setHref('migrations-link', getMigrationsLink());
    setHref('network-link', getNetworkLink());
    setHref('eventstream-link', getEventStreamLink());
};

const loadDiagnostic = async (ts) => {
  if (ts === -1) {
    return await _loadJsonResource(_timestampToShardedDataPath(diagnostic_ui_config.firstTimeStamp));
  }
  return await _loadJsonResource(_timestampToShardedDataPath(ts));
};

const loadReport = async (reportName) => {
  return await _loadJsonResource(reportName);
};

const _loadJsonResource = async (path) => {
  try {
    const res = await fetch(`data/${path}`);
    if (!res.ok) throw new Error(`Failed to fetch ${path}: ${res.statusText}`);
    return await res.json();
  } catch (error) {
    console.error(error);
  }
};

const _timestampToShardedDataPath = (ts) => {
  return `${new Date(ts).toISOString().substr(0, 10)}/${ts}.gz`;
};

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

const renderSlider = (slider, onUpdate, onChange) => {
   const format = {
      to: (value) => diagnosticsTimeSeries.dates[Math.round(value)],
      from: (value) => diagnosticsTimeSeries.datesIndexMap[value]
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

    slider.noUiSlider.on('update', () => {
        const values = slider.noUiSlider.get();
        diagnosticsTimeSeries.start = values[0];
        diagnosticsTimeSeries.middle = values[1];
        diagnosticsTimeSeries.end = values[2];
        onUpdate();
    });

    slider.noUiSlider.on('change', () => {
        const values = slider.noUiSlider.get();
        diagnosticsTimeSeries.middle = values[1];
        diagnosticsTimeSeries.start = values[0];
        diagnosticsTimeSeries.end = values[2];
        onChange();
    });

    const connect = slider.querySelectorAll('.noUi-connect');
    if (connect.length >= 2) {
      connect[0].classList.add('c-1-color');
      connect[1].classList.add('c-1-color');
    }
    mergeTooltips(slider, 15, ' - ');
};

const getPageDateRange = () => {
   const urlParams = new URLSearchParams(window.location.search);
   let pageStart = urlParams.get('start') ? parseInt(urlParams.get('start'), 10) : -1;
   let pageMiddle = urlParams.get('middle') ? parseInt(urlParams.get('middle'), 10) : -1;
   let pageEnd = urlParams.get('end') ? parseInt(urlParams.get('end'), 10) : -1;
   return [pageStart, pageMiddle, pageEnd];
};

const getDefaultDateRange = (timeStampMap, dates) => {
   if (diagnosticsTimeSeries.dates.length < 1440) {
      return [
        diagnosticsTimeSeries.dates[0], 
        diagnosticsTimeSeries.dates[Math.floor(diagnosticsTimeSeries.dates.length / 2)],
        diagnosticsTimeSeries.dates[diagnosticsTimeSeries.dates.length - 1]
      ];
   }
   return [
     diagnosticsTimeSeries.dates[0],
     diagnosticsTimeSeries.dates[1440 / 2],
     diagnosticsTimeSeries.dates[1440 - 1]
   ];
};

const initialiseDateRange = (timeStampMap, dates) => {
   const [pageStart, pageMiddle, pageEnd] = getPageDateRange();

   if (pageStart === -1 || pageMiddle === -1 || pageEnd === -1) {
      return getDefaultDateRange(timeStampMap, dates);
   }

   if (!(pageStart in timeStampMap) || !(pageMiddle in timeStampMap) || !(pageEnd in timeStampMap)) {
      return getDefaultDateRange(timeStampMap, dates);
   }

   return [
     dates[timeStampMap[pageStart]],
     dates[timeStampMap[pageMiddle]],
     dates[timeStampMap[pageEnd]]
   ];
};

const generateDiagnosticTimeSeries = (timeStamps) => {
    diagnosticsTimeSeries.timeStamps = timeStamps;
    diagnosticsTimeSeries.dates = diagnosticsTimeSeries.timeStamps.map(toDate);
    
    diagnosticsTimeSeries.dates.forEach((date, i) => {
       if (date in diagnosticsTimeSeries.datesIndexMap) {
          console.log(`${date} already mapped`);
       }
       diagnosticsTimeSeries.datesIndexMap[date] = i;
       diagnosticsTimeSeries.timeStampMap[diagnosticsTimeSeries.timeStamps[i]] = i;
    });

    const range = initialiseDateRange(diagnosticsTimeSeries.timeStampMap, diagnosticsTimeSeries.dates);
    diagnosticsTimeSeries.start = range[0];
    diagnosticsTimeSeries.middle = range[1];
    diagnosticsTimeSeries.end = range[2];
};

const mergeTooltips = (slider, threshold, separator) => {
    const textIsRtl = getComputedStyle(slider).direction === 'rtl';
    const isRtl = slider.noUiSlider.options.direction === 'rtl';
    const isVertical = slider.noUiSlider.options.orientation === 'vertical';
    const tooltips = slider.noUiSlider.getTooltips();
    const origins = slider.noUiSlider.getOrigins();

    tooltips.forEach((tooltip, index) => {
        if (tooltip) {
            origins[index].appendChild(tooltip);
        }
    });

    slider.noUiSlider.on('update', (values, handle, unencoded, tap, positions) => {
        const pools = [[]];
        const poolPositions = [[]];
        const poolValues = [[]];
        let atPool = 0;

        if (tooltips[0]) {
            pools[0][0] = 0;
            poolPositions[0][0] = positions[0];
            poolValues[0][0] = values[0];
        }

        for (let i = 1; i < positions.length; i++) {
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

        pools.forEach((pool, poolIndex) => {
            const handlesInPool = pool.length;
            for (let j = 0; j < handlesInPool; j++) {
                const handleNumber = pool[j];
                if (j === handlesInPool - 1) {
                    let offset = 0;
                    poolPositions[poolIndex].forEach(value => {
                        offset += 1000 - value;
                    });
                    const direction = isVertical ? 'bottom' : 'right';
                    const last = isRtl ? 0 : handlesInPool - 1;
                    const lastOffset = 1000 - poolPositions[poolIndex][last];
                    offset = (textIsRtl && !isVertical ? 100 : 0) + (offset / handlesInPool) - lastOffset;

                    tooltips[handleNumber].innerHTML = poolValues[poolIndex].join(separator);
                    tooltips[handleNumber].style.display = 'block';
                    tooltips[handleNumber].style[direction] = `${offset}%`;
                } else {
                    tooltips[handleNumber].style.display = 'none';
                }
            }
        });
    });
};

const migrationIdMap = {};
const migrationNameMap = {};

const buildMigrationIdMap = (diagnostics) => {
  for (const diag of diagnostics) {
      if (diag.type === 'ActionStoreDiagnosticDTO') {
          migrationIdMap[diag.id] = diag.migrationId;
          migrationNameMap[diag.migrationId] = diag.id;
      }
  }
};

const getCurrentTransferPercentiles = (diagnosticSet) => {
  const diagnostic = diagnosticSet.diagnostics.find(d => d.type === 'FileTrackerDiagnosticDTO');
  if (!diagnostic) return null;
  
  const fileTrackers = diagnostic.fileTrackers;
  const size = [];
  const rate = [];
  const latency = [];
  const fileTrackerMigrationMap = new Map();

  fileTrackers.forEach(tracker => {
    size.push(tracker.FileLength);
    rate.push(tracker.BytesPerSecond);
    latency.push(tracker.EventLatency);
    const count = fileTrackerMigrationMap.get(tracker.MigrationId) || 0;
    fileTrackerMigrationMap.set(tracker.MigrationId, count + 1);
  });

  const count = fileTrackers.length;
  const fileTrackerMigrationMapSorted = new Map([...fileTrackerMigrationMap.entries()].sort((a, b) => b[1] - a[1]));
  
  const fileTrackerMigrationMapKeys = [...fileTrackerMigrationMapSorted.keys()];
  const fileTrackerMigrationMapValues = [...fileTrackerMigrationMapSorted.values()];

  const fileTrackerPercentileRange = Array.from({ length: 100 }, (_, i) => i + 1);
  const fileTrackersSizePercentiles = percentile(fileTrackerPercentileRange, size);
  const fileTrackersRatePercentiles = percentile(fileTrackerPercentileRange, rate);
  const fileTrackersLatencyPercentiles = percentile(fileTrackerPercentileRange, latency);

  return {
    count, 
    fileTrackerPercentileRange, 
    fileTrackersSizePercentiles, 
    fileTrackersRatePercentiles, 
    fileTrackersLatencyPercentiles, 
    fileTrackerMigrationMapKeys, 
    fileTrackerMigrationMapValues 
  };
};
