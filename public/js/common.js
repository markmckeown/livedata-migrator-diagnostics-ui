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
  return new Date(value).toISOString().slice(0,-5);
}

function toTime(value, index, array) {
  return new Date(value).toISOString().replace('T', ' ').substring(0, 19).split(' ')[1];
}

function toMBSecond(value, index, array) {
  return Math.floor((value * 8)/(1000 * 1000))
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

