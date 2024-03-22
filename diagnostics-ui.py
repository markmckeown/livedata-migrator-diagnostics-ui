#!/usr/bin/env python
# -*- coding: utf-8 -*-
# Copyright © WANDisco 2023
#
# Author: Colm Dougan, Mark Mc Keown
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.


import argparse
import datetime
import fnmatch
import glob
import gzip
import hashlib
import multiprocessing
import os
import re
import shutil
import sys
import tarfile
import tempfile
import time
import traceback

import json

if sys.version_info.major == 3:
    # python-3.x
    from http.server import HTTPServer as DefaultServerClass
    from http.server import BaseHTTPRequestHandler as DefaultHandlerClass
    from http.server import SimpleHTTPRequestHandler
else:
    # python-2.x
    from BaseHTTPServer import HTTPServer as DefaultServerClass
    from BaseHTTPServer import BaseHTTPRequestHandler as DefaultHandlerClass
    from SimpleHTTPServer import SimpleHTTPRequestHandler

DEFAULT_WWW_BIND = "0.0.0.0"
DEFAULT_WWW_PORT = 8000
# Json returned from is static, set cache control to 5 minutes.
DATA_FILES_MAX_AGE = 300
# Pattern to match diagnostic log files
DIAGNOSTIC_LOG_FILE_PATTERN = "diagnostic*log*"

SHARD_DIR_PATTERN = re.compile(r"\/\d{4}-\d\d-\d\d$")


class DiagnosticsHttpServer(SimpleHTTPRequestHandler):
    def do_GET(self):
        if "/data/" in self.path and self._handle_data_request():
            return

        return SimpleHTTPRequestHandler.do_GET(self)

    # NOTE: all this gzip stuff can be done by Apache or Nginx.
    def _handle_data_request(self):
        # assuming a request for /LM2-12345/data/someReport : we want to
        # ascertain if we have a pre-gzipped datafile (which would be
        # named /$web_root/LM2-12345/data/someReport.gz) in which case
        # we can just response with that pre-compressed file (and
        # appropriate content-encoding header)
        pre_gzipped_data = os.path.join(self.custom_dir, self.path.lstrip("/"))
        if os.path.exists(pre_gzipped_data):
            with open(pre_gzipped_data, "rb") as f:
                fs = os.fstat(f.fileno())
                content_length = fs[6]

                self.send_response(200)
                self.send_header("Content-Length", str(content_length))
                # For Apache/Nginx we will need to have it set the
                # following headers for paths that match this pattern.
                self.send_header("Content-encoding", "gzip")
                self.send_header("Cache-Control", "max-age=" + str(DATA_FILES_MAX_AGE))
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                shutil.copyfileobj(f, self.wfile)
            return True

        return False

    # NOTE: this is necessary workaround because python 2.x http.server
    # implementation does not support the "directory" option (i.e. it
    # only supports serving files from CWD)
    # python3 does have an optional "directory" parameter but only since
    # python-3.7 so doesn't help python3 versions < 3.7
    # Therefore this custom_dir workaround seems to be necessary and in
    # my testing has proven compatible across the versions I've tested
    # (tested on 2.7, 3.3, 3.5, 3.7)
    def translate_path(self, path):
        if self.custom_dir is not None:
            return SimpleHTTPRequestHandler.translate_path(
                self, self.custom_dir + "/" + path
            )

        return SimpleHTTPRequestHandler.translate_path(self, path)

    def _header_get_all(self, header):
        return self.headers.get_all(header, ())


def open_file(in_file):
    if in_file.endswith(".gz"):
        return gzip.open(in_file, "rt")

    return open(in_file)


# this is just an effort to normalize numbers for deterministic
# comparison witht he the node generated report output files
# (in node: 0.0 is rounded to just 0)
def num_fmt(num):
    if str(num).endswith(".0"):
        return int(num)
    return num


class SchemaTranslator(object):
    # For translating names during schema changes.
    type_translation_map = {
        "ActionStoreDiagnostic": "ActionStoreDiagnosticDTO",
        "CpuLoadDiagnostic": "CpuLoadDiagnosticDTO",
        "EventManagerDiagnostic": "EventManagerDiagnosticDTO",
        "FileTrackerDiagnostic": "FileTrackerDiagnosticDTO",
        "InotifyDiagnostic": "InotifyDiagnosticDTO",
        "JvmGcDiagnostic": "JvmGcDiagnosticDTO",
        "LinuxPressureDiagnostic": "LinuxPressureDiagnosticDTO",
        "MigrationsDiagnostic": "MigrationDiagnosticDTO",
        "NetworkStatus": "NetworkStatusDTO",
        "ThroughputDiagnostic": "ThroughputDiagnosticDTO",
    }

    def translate(self, diagnostic):
        for entry in diagnostic["diagnostics"]:
            self._rewrite_kind_to_type(entry)
            self._rewrite_iowait(entry)

        return diagnostic

    # legacy schema fixes
    def _rewrite_kind_to_type(self, entry):
        if "kind" not in entry:
            return entry

        elif entry["kind"] == "FileTrackerDiagnostic":
            # Rename activeFileTransfers to fileTrackers
            trackers = entry["activeFileTransfers"]
            del entry["activeFileTransfers"]
            entry["fileTrackers"] = trackers
            ratePercentiles = entry["fileTransferRatesPercentiles"]
            del entry["fileTransferRatesPercentiles"]
            entry["fileTransferRatePercentiles"] = ratePercentiles
        elif entry["kind"] == "ThroughputDiagnostic":
            timePeriodSeconds = entry["timePeriodSeconds"]
            bytesMigratedForPeriod = entry["bytesMigratedForPeriod"]
            filesMigratedForPeriod = entry["filesMigratedForPeriod"]
            peakBytesMigrated = entry["peakBytesMigrated"]
            peakFilesMigrated = entry["peakFilesMigrated"]
            del entry["timePeriodSeconds"]
            del entry["bytesMigratedForPeriod"]
            del entry["filesMigratedForPeriod"]
            del entry["peakBytesMigrated"]
            del entry["peakFilesMigrated"]
            entry["period"] = timePeriodSeconds
            entry["bytesMigrated"] = bytesMigratedForPeriod
            entry["filesMigrated"] = filesMigratedForPeriod
            entry["peakBytesMigrated"] = peakBytesMigrated
            entry["peakFilesMigrated"] = peakFilesMigrated

        # Change from kind to type as the key, change the
        # value by adding the 'DTO'
        new_type = self.type_translation_map[entry["kind"]]
        del entry["kind"]
        entry["type"] = new_type

        return entry

    # not functionally necessary but we do this for
    # normalization/comparison with the legacy node processing
    def _rewrite_iowait(self, entry):
        if entry["type"] == "LinuxPressureDiagnosticDTO":
            if "iowaitPercentage" in entry:
                entry["iowaitPercentage"] = num_fmt(entry["iowaitPercentage"])


class WorkspaceRepository(object):
    def __init__(self, workspace, filepath, sharder):
        self.workspace = workspace
        self.filepath = filepath
        self.sharder = sharder

    def mkdirs(self):
        if not os.path.exists(self.workspace):
            os.mkdir(self.workspace)

        data_dir = self.getDataDir()
        if not os.path.exists(data_dir):
            os.makedirs(data_dir)

    def getDir(self):
        return self.workspace

    def getDataDir(self):
        return os.path.join(self._getWorkspaceDir(), "data")

    def getReportDir(self):
        return self.getDataDir()

    def getHtmlDir(self):
        return self._getWorkspaceDir()

    def writeDiagnostic(self, data):
        outfile = self._path_for_diagnostic(data["timeStamp"])
        # Only write file if it does not already exist - an append
        # could have overlapping diagnostics.
        if not os.path.exists(outfile):
            with gzip.open(outfile, "wb") as rf:
                rf.write(json.dumps({"diagnosticSet": data}).encode("utf-8"))

    def _path_for_diagnostic(self, timestamp):
        shard_dir = os.path.join(self.getDataDir(), self.sharder.get(timestamp))
        if not os.path.exists(shard_dir):
            os.mkdir(shard_dir)

        return os.path.join(shard_dir, str(timestamp) + ".gz")

    def _getWorkspaceDir(self):
        filename = os.path.basename(self.filepath)

        def MD5(s):
            return hashlib.md5(s.encode("utf-8")).hexdigest()

        return self.workspace + "/" + filename


class ReportBuilder(object):
    def __init__(self, observations):
        self.observations = observations

    def buildMigrationDiagnostics(self):
        return self._fill(
            {
                "timeStamp": [],
                "failedPaths": [],
                "retries": [],
            }
        )

    def buildEventManagerDBdiagnostics(self):
        return self._fill(
            {
                "timeStamp": [],
                "eventManagerMeanDbTime": [],
                "eventManagerMaxDbTime": [],
            }
        )

    def buildFileTrackers(self):
        return self._fill(
            {
                "timeStamp": [],
                "filetrackerCount": [],
                "bytesPerSecond": [],
            }
        )

    def buildQueueDiagnostics(self):
        result = self._fill(
            {
                "timeStamp": [],
                "pendingRegions": [],
                "events": [],
                "maxLatency": [],
                "actionQueueLatency": [],
                "sourceEventLatency": [],
            }
        )

        # get the Events Added Delta
        result["deltaEventsAdded"] = []
        deltas = self.observations.getDeltas()
        for key in sorted(deltas):
            result["deltaEventsAdded"].append(deltas[key]["deltaEventsAdded"])

        # compute this field
        result["actions"] = [
            o.actionStoreFoundCount for o in self.observations.retrieve_all()
        ]

        return result

    def buildNetworkDiagnostics(self):
        return self._fill(
            {
                "timeStamp": [],
                "connectionCount": [],
                "totalRxQueue": [],
                "totalTxQueue": [],
                "retrnsmt": [],
                "bytesPerSecond": [],
            }
        )

    def buildJvmGCTimeDiagnostics(self):
        result = self._fill(
            {
                "timeStamp": [],
                "gcAverageTime": [],
            }
        )

        # additional report field that needs to be computed and which is
        # derived derived from the 'gcPauseTime' bucket
        #
        # NOTE: we have to do this here because the previousGCTime carries
        # over from previous diagnostics/observations and so we can't
        # compute it as we go along because observations may be
        # collected in any order

        result["gcTimeForPeriod"] = []

        previousGCTime = 0
        for o in self.observations.retrieve_all():
            for gcTime in o.buckets.gcPauseTime:
                if previousGCTime == 0:
                    # restart
                    result["gcTimeForPeriod"].append(0)
                else:
                    result["gcTimeForPeriod"].append(gcTime - previousGCTime)

            previousGCTime = gcTime

        return result

    def buildSystemCPUDiagnostics(self):
        return self._fill(
            {
                "timeStamp": [],
                "processCpuLoad": [],
                "systemCpuLoad": [],
            }
        )

    def buildIoWaitPercentage(self):
        return self._fill(
            {
                "timeStamp": [],
                "ioWaitPercentage": [],
            }
        )

    def buildThroughPutDiagnostics(self):
        return self._fill(
            {
                "timeStamp": [],
                "bytesPerSecond": [],
                "filesForPeriod": [],
                "filesPerSecond": [],
                "totalFileSizeBeingTransferred": [],
                "filetrackerCount": [],
            }
        )

    def buildEventStream(self):
        return self._fill(
            {
                "timeStamp": [],
                "avgEventsReadPerCall": [],
                "maxEventsReadPerCall": [],
                "avgRpcCallTime": [],
                "maxRpcCallTime": [],
                "maxEventsBehind": [],
                "avgEventsBehind": [],
            }
        )

    def buildDiagnosticsCollectionTime(self):
        return self._fill(
            {
                "timeStamp": [],
                "collectionTime": [],
            }
        )

    def buildDeltas(self):
        return self.observations.getDeltas()

    def _fill(self, result):
        for o in self.observations.retrieve_all():
            for f in result.keys():
                if f == "timeStamp":
                    result["timeStamp"].append(o.timeStamp)
                elif f == "collectionTime":
                    result["collectionTime"].append(o.collectionTime)
                else:
                    result[f].extend(getattr(o.buckets, f))

        return result


class ReportWriter(object):
    def write(self, outdir, report_builder):
        functionMap = {
            "throughput": report_builder.buildThroughPutDiagnostics,
            "iowaitpercentage": report_builder.buildIoWaitPercentage,
            "systemCPU": report_builder.buildSystemCPUDiagnostics,
            "jvmGC": report_builder.buildJvmGCTimeDiagnostics,
            "network": report_builder.buildNetworkDiagnostics,
            "queues": report_builder.buildQueueDiagnostics,
            "filetrackers": report_builder.buildFileTrackers,
            "db_diagnostics": report_builder.buildEventManagerDBdiagnostics,
            "migration_failures": report_builder.buildMigrationDiagnostics,
            "diagnostic_collection_time": report_builder.buildDiagnosticsCollectionTime,
            "deltas": report_builder.buildDeltas,
            "eventstream": report_builder.buildEventStream,
        }

        for reportName, fn in functionMap.items():
            reportFile = self._getReportsFile(outdir, reportName)
            reportData = fn()

            with gzip.open(reportFile, "wb") as rf:
                rf.write(json.dumps(reportData).encode("utf-8"))

    def _getReportsFile(self, outdir, reportName):
        return os.path.join(outdir, reportName + ".gz")


class StatsBuckets(object):
    def __init__(self):
        self.bytesPerSecond = []
        self.totalFileSizeBeingTransferred = []
        self.maxLatency = []
        self.sourceEventLatency = []
        self.actionQueueLatency = []
        self.filesForPeriod = []
        self.filesPerSecond = []
        self.ioWaitPercentage = []
        self.connectionCount = []
        self.totalRxQueue = []
        self.totalTxQueue = []
        self.retrnsmt = []
        self.pendingRegions = []
        self.events = []
        self.totalEventsAdded = []
        self.failedPaths = []
        self.retries = []
        self.processCpuLoad = []
        self.systemCpuLoad = []
        self.gcAverageTime = []
        self.gcPauseTime = []
        self.filetrackerCount = []
        self.eventManagerMeanDbTime = []
        self.eventManagerMaxDbTime = []
        self.avgEventsReadPerCall = []
        self.maxEventsReadPerCall = []
        self.avgRpcCallTime = []
        self.maxRpcCallTime = []
        self.avgEventsBehind = []
        self.maxEventsBehind = []


class ObservationsForTimestamp(object):
    def __init__(self, timeStamp, collectionTime):
        self.timeStamp = timeStamp
        self.collectionTime = collectionTime
        self.buckets = StatsBuckets()
        self.migrations = {}
        self.migrationsTransferCounts = {}
        self.actionStoreFoundCount = 0
        self.totalRequeueCount = 0
        self.fixed = False
        # BUG - sometimes throughput is not set and diagnostic is
        # essentially corrupt. Perhaps straight after a restart?
        # need to skip these ones.
        self.throughputSet = False

    def fix(self):
        if self.fixed == True:
            raise Exception(
                "Attempt to fix a ObservationsForTimestamp that is already fixed."
            )

        if not self.throughputSet:
            raise Exception(
                "Diagnostic %d missing ThroughputDiagnosticDTO, skipping as corrupt."
                % (self.timeStamp)
            )

        # Remap the ids for activeTransfers
        for key, value in self.migrations.items():
            if value["id"] in self.migrationsTransferCounts:
                value["activeTransfers"] = self.migrationsTransferCounts[value["id"]]

        self.fix = True
        return self

    def add(self, diagnostic):
        if self.fixed == True:
            raise Exception(
                "Attempt to add to a ObservationsForTimestamp that is fixed."
            )

        if diagnostic["type"] == "ThroughputDiagnosticDTO":
            self.throughputSet = True
            self.buckets.bytesPerSecond.append(
                num_fmt(diagnostic["bytesMigrated"] / float(diagnostic["period"]))
            )
            self.buckets.filesForPeriod.append(diagnostic["filesMigrated"])
            self.buckets.filesPerSecond.append(
                num_fmt(diagnostic["filesMigrated"] / float(diagnostic["period"]))
            )

        elif diagnostic["type"] == "LinuxPressureDiagnosticDTO":
            self.buckets.ioWaitPercentage.append(
                num_fmt(diagnostic.get("iowaitPercentage"))
            )

        elif diagnostic["type"] == "InotifyDiagnosticDTO":
            self.buckets.avgEventsReadPerCall.append(
                num_fmt(diagnostic.get("avgEventsReadPerCall"))
            )
            self.buckets.maxEventsReadPerCall.append(
                num_fmt(diagnostic.get("maxEventsReadPerCall"))
            )
            self.buckets.avgRpcCallTime.append(
                num_fmt(diagnostic.get("avgRpcCallTime"))
            )
            self.buckets.maxRpcCallTime.append(
                num_fmt(diagnostic.get("maxRpcCallTime"))
            )
            self.buckets.maxEventsBehind.append(
                num_fmt(diagnostic.get("maxEventsBehind"))
            )
            self.buckets.avgEventsBehind.append(
                num_fmt(diagnostic.get("avgEventsBehind"))
            )

        elif diagnostic["type"] == "NetworkStatusDTO":
            self.buckets.connectionCount.append(len(diagnostic["connections"]))
            totals = self._getConnectionTotals(diagnostic["connectionTotals"])
            self.buckets.totalRxQueue.append(totals["totalRxQueue"])
            self.buckets.totalTxQueue.append(totals["totalTxQueue"])
            self.buckets.retrnsmt.append(totals["retrnsmt"])

        elif diagnostic["type"] == "MigrationDiagnosticDTO":
            if "totalPendingRegions" not in diagnostic:
                diagnostic["totalPendingRegions"] = sum(
                    diagnostic["pendingRegions"].values()
                )
            self.buckets.pendingRegions.append(diagnostic["totalPendingRegions"])

            if "totalFailedPaths" not in diagnostic:
                diagnostic["totalFailedPaths"] = sum(diagnostic["failedPaths"].values())
            self.buckets.failedPaths.append(diagnostic["totalFailedPaths"])

            if "totalPathRetryCount" not in diagnostic:
                diagnostic["totalPathRetryCount"] = sum(
                    diagnostic["pathRetryCount"].values()
                )
            self.buckets.retries.append(diagnostic["totalPathRetryCount"])
            # process the individual migrations information.
            self._process_migration_diagnostic_dto(diagnostic)

        elif diagnostic["type"] == "EventManagerDiagnosticDTO":
            self.buckets.events.append(diagnostic["totalQueuedEvents"])
            self.buckets.totalEventsAdded.append(diagnostic["totalEventAdded"])
            self.buckets.eventManagerMeanDbTime.append(
                num_fmt(diagnostic["meanDbTime"])
            )
            self.buckets.eventManagerMaxDbTime.append(num_fmt(diagnostic["maxDbTime"]))

        elif diagnostic["type"] == "ActionStoreDiagnosticDTO":
            # There can be multiple ActionStore diagnostics, one for
            # each migration so they need to be summed up.
            self.actionStoreFoundCount += diagnostic["totalUnExecutedEvents"]
            # Collect per migration information - this races with processing
            # of MigrationDiagnosticDTO
            migration = self._getMigrationsRecord(diagnostic["migrationId"])
            migration["id"] = diagnostic["id"]
            migration["maxUnexecutedEvents"] = diagnostic["maxUnexecutedEvents"]
            migration["totalUnExecutedEvents"] = diagnostic["totalUnExecutedEvents"]

        elif diagnostic["type"] == "CpuLoadDiagnosticDTO":
            self.buckets.systemCpuLoad.append(num_fmt(diagnostic["systemCpuLoad"]))
            self.buckets.processCpuLoad.append(num_fmt(diagnostic["processCpuLoad"]))

        elif diagnostic["type"] == "JvmGcDiagnosticDTO":
            self.buckets.gcAverageTime.append(
                num_fmt(diagnostic["gcPauseTime"] / float(diagnostic["gcCount"]))
            )
            self.buckets.gcPauseTime.append(diagnostic["gcPauseTime"])

        elif diagnostic["type"] == "FileTrackerDiagnosticDTO":
            self.buckets.filetrackerCount.append(len(diagnostic["fileTrackers"]))
            # Collect the Active Transfer count per migration - this is keyed of
            # the migrations internal id, will need to translate this to the user
            # provided migration id in the fix method.
            totalFileSizeBeingTransferred = 0
            maxLatency = 0
            sourceEventLatency = 0
            actionQueueLatency = 0
            for filetracker in diagnostic["fileTrackers"]:
                identity = filetracker["MigrationId"]
                totalFileSizeBeingTransferred = (
                    totalFileSizeBeingTransferred + filetracker["FileLength"]
                )

                if filetracker["EventLatency"] > maxLatency:
                    maxLatency = filetracker["EventLatency"]
                    sourceEventLatency = (
                        filetracker["LdmEventCreationTimeStamp"]
                        - filetracker["SourceEventCreationTimeStamp"]
                    )
                    actionQueueLatency = (
                        filetracker["StartTime"]
                        - filetracker["LdmEventCreationTimeStamp"]
                    )

                if identity in self.migrationsTransferCounts:
                    self.migrationsTransferCounts[identity] = (
                        self.migrationsTransferCounts[identity] + 1
                    )
                else:
                    self.migrationsTransferCounts[identity] = 1

            self.buckets.totalFileSizeBeingTransferred.append(
                totalFileSizeBeingTransferred
            )
            self.buckets.maxLatency.append(maxLatency)
            self.buckets.sourceEventLatency.append(sourceEventLatency)
            self.buckets.actionQueueLatency.append(actionQueueLatency)

    def _process_migration_diagnostic_dto(self, migration_diagnostic):
        # Address broken change in diagnostics schema
        if "migrationScannerProgress" not in migration_diagnostic:
            migrationScannerProgress = migration_diagnostic["scannerProgress"]
        else:
            migrationScannerProgress = migration_diagnostic["migrationScannerProgress"]

        for migrationId in migration_diagnostic["pendingRegions"]:
            # self.migrations will be pre-populated by processing ActionStoreDiagnsotic
            # but some migrations might not have ActionStoreDiagnsotic entries
            migration = self._getMigrationsRecord(migrationId)
            migration.update(migrationScannerProgress[migrationId])
            migration["pathRetryCount"] = migration_diagnostic["pathRetryCount"][
                migrationId
            ]
            migration["pendingRegionsMax"] = migration_diagnostic["pendingRegionsMax"][
                migrationId
            ]
            migration["failedPaths"] = migration_diagnostic["failedPaths"][migrationId]
            migration["pendingRegions"] = migration_diagnostic["pendingRegions"][
                migrationId
            ]
            if "migrationPathsRequeued" in migration_diagnostic:
                migration["migrationPathsRequeued"] = migration_diagnostic[
                    "migrationPathsRequeued"
                ][migrationId]

        if "migrationPathsRequeued" in migration_diagnostic:
            for key in migration_diagnostic["migrationPathsRequeued"]:
                self.totalRequeueCount = (
                    self.totalRequeueCount
                    + migration_diagnostic["migrationPathsRequeued"][key]
                )

    def _getMigrationsRecord(self, migrationId):
        # get the migration record for migration, if we do
        # not have one then generate it.
        if migrationId not in self.migrations:
            self.migrations[migrationId] = {
                "id": "-",
                "maxUnexecutedEvents": 0,
                "totalUnExecutedEvents": 0,
                "pathRetryCount": 0,
                "pendingRegionsMax": 0,
                "failedPaths": 0,
                "pendingRegions": 0,
                "migrationPathsRequeued": -1,
                "activeTransfers": 0,
            }

        return self.migrations[migrationId]

    def _getConnectionTotals(self, connectionTotals):
        totalRxQueue = 0
        totalTxQueue = 0
        retrnsmt = 0

        for x, connectionTotal in connectionTotals.items():
            totalRxQueue = totalRxQueue + connectionTotal["totalRxQueue"]
            totalTxQueue = totalTxQueue + connectionTotal["totalTxQueue"]
            retrnsmt = retrnsmt + connectionTotal["retrnsmt"]

        return dict(
            totalRxQueue=totalRxQueue, totalTxQueue=totalTxQueue, retrnsmt=retrnsmt
        )


class ObservationAccumulator(object):
    def __init__(self):
        self.observations = []
        self.deltasMap = {}
        self.fixed = False

    def add(self, obv):
        if self.fixed:
            raise Exception("Attempt to add after ObservationAccumulator completed.")

        self.observations.extend(obv)

    def getDeltas(self):
        if not self.fixed:
            self.retrieve_all()

        return self.deltasMap

    def retrieve_all(self):
        if self.fixed:
            return self.observations

        filter_map = {}
        # append could lead to duplicates - suboptimal
        # to do this each time retrieve_all is called.
        for o in self.observations:
            filter_map[o.timeStamp] = o

        self.observations = sorted(filter_map.values(), key=lambda o: o.timeStamp)

        # We depend on entries in ActionStore for creating a mapping
        # between migration Ids and migration Names. Sometimes there
        # there may not be an ActionStore entry - so we need run over
        # the data again to fill out the missing Migration Ids.
        mapNameToId = {}
        # First fill out the Name -> Id map.
        for observation in self.observations:
            migrations = observation.migrations
            for key, value in migrations.items():
                if value["id"] != "-":
                    mapNameToId[key] = value["id"]

        missing_migration_ids = set()
        for observation in self.observations:
            migrations = observation.migrations
            for key, value in migrations.items():
                if value["id"] == "-":
                    if key in mapNameToId:
                        value["id"] = mapNameToId[key]
                    else:
                        missing_migration_ids.add(key)

        if len(missing_migration_ids) > 0:
            print(
                "No internal Migration Id mapping for %s migrations."
                % len(missing_migration_ids)
            )

        self._buildDeltas()
        self.fixed = True
        return self.observations

    def _emptyDelta(self):
        return {
            "deltaEventsQueued": 0,
            "deltaEventsAdded": 0,
            "deltaPendingRegions": 0,
            "deltaActions": 0,
            "deltaFailedPaths": 0,
            "deltaRetries": 0,
            "deltaRequeues": 0,
        }

    def _buildDeltas(self):
        self.deltasMap = {}
        firstDelta = self._emptyDelta()
        count = 0
        for o in self.observations:
            if count == 0:
                self.deltasMap[o.timeStamp] = firstDelta
                previousO = o
                count = count + 1
                continue

            delta = self._emptyDelta()
            delta["deltaActions"] = (
                o.actionStoreFoundCount - previousO.actionStoreFoundCount
            )
            delta["deltaEventsQueued"] = (
                o.buckets.events[0] - previousO.buckets.events[0]
            )
            delta["deltaEventsAdded"] = (
                o.buckets.totalEventsAdded[0] - previousO.buckets.totalEventsAdded[0]
            )
            # Catch possible restart when totalEventsAdded could be reset to zero
            if delta["deltaEventsAdded"] < 0:
                delta["deltaEventsAdded"] = 0

            delta["deltaFailedPaths"] = (
                o.buckets.failedPaths[0] - previousO.buckets.failedPaths[0]
            )
            delta["deltaPendingRegions"] = (
                o.buckets.pendingRegions[0] - previousO.buckets.pendingRegions[0]
            )
            delta["deltaRetries"] = o.buckets.retries[0] - previousO.buckets.retries[0]
            delta["deltaRequeue"] = o.totalRequeueCount - previousO.totalRequeueCount
            self.deltasMap[o.timeStamp] = delta
            previousO = o

        return self.deltasMap


def process_file_impl(workspace, filepath, filename):
    proc = multiprocessing.current_process()
    sys.stderr.write("[%s] Processing %s\n" % (proc.pid, filename))

    observations = []

    with open_file(filename) as fh:
        line_num = 0
        schema_translator = SchemaTranslator()
        try:
            for line in fh:
                line_num += 1
                try:
                    row = schema_translator.translate(json.loads(line[25:]))
                    obv = ObservationsForTimestamp(
                        row["timeStamp"], row["collectionTime"]
                    )

                    # fill ObservationsForTimestamp with the relevant info for this
                    # timestamp.
                    for i, diagnostic in enumerate(row["diagnostics"]):
                        obv.add(diagnostic)

                    observations.append(obv.fix())
                    workspace.writeDiagnostic(row)
                except Exception as e:
                    # Corrupt diagnostics
                    # TODO - add logging and make this debug.
                    sys.stderr.write(traceback.format_exc())
                    sys.stderr.write("    Skipping line %d [%s]\n" % (line_num, str(e)))
        except Exception as e:
            # Corruption reading file
            sys.stderr.write(traceback.format_exc())
            sys.stderr.write("    Corrupt file %s\n" % (filename))

    return filename, observations


def process_file(args):
    (workspace, filepath, filename) = args
    try:
        return process_file_impl(workspace, filepath, filename)
    except KeyboardInterrupt:
        raise StopIteration


def load_file_impl(filename):
    proc = multiprocessing.current_process()
    sys.stderr.write("[%s] Loading %s\n" % (proc.pid, filename))
    observations = []

    # There is only one line in these files.
    with open_file(filename) as fh:
        for line in fh:
            try:
                row = json.loads(line)["diagnosticSet"]
                obv = ObservationsForTimestamp(row["timeStamp"], row["collectionTime"])

                # fill ObservationsForTimestamp with the relevant info for this
                # timestamp.
                for i, diagnostic in enumerate(row["diagnostics"]):
                    obv.add(diagnostic)

                observations.append(obv.fix())
            except Exception as e:
                sys.stderr.write(traceback.format_exc())
                sys.stderr.write("    Skipping file %s [%s]\n" % (filename, str(e)))

    return filename, observations


def load_file(args):
    try:
        return load_file_impl(args[0])
    except KeyboardInterrupt:
        raise StopIteration


class HtdocsGenerator(object):
    def __init__(self, public_dir, workspace_dir, www_dir, data_dir):
        self.public_dir = public_dir
        self.workspace_dir = workspace_dir
        self.www_dir = www_dir
        self.data_dir = data_dir

    def generate(self, outdir):
        # Copy HTML and Javascript files into dataset
        # directory. We could symlink but if we change
        # Javascript/HTML it could lead to breakage
        # in old datasets.
        self._copytree(self.public_dir, self.www_dir)

        # Need to make sure favicon.ico is in the www root
        # directory
        favicon_target = os.path.join(self.workspace_dir, "favicon.ico")
        if not os.path.exists(favicon_target):
            shutil.copyfile(
                os.path.join(self.public_dir, "favicon.ico"), favicon_target
            )

    def _copytree(self, src, dst):
        for item in os.listdir(src):
            s = os.path.join(src, item)
            d = os.path.join(dst, item)
            if os.path.isdir(s):
                if not os.path.exists(d):
                    os.mkdir(d)
                self._copytree(s, d)
            else:
                # Will overwrite file if it exists.
                shutil.copyfile(s, d)


def log_file_sort_key(filename):
    if filename.endswith("diagnostics.log"):
        return float("inf")

    date_pattern = "([0-9]{4}-[0-9]{2}-[0-9]{2})\\.([0-9]+)"

    try:
        gs = next(re.finditer(date_pattern, filename)).groups()
    except StopIteration:
        # File name has been mangled and no longer contains date,
        # try file modified time (which may not be correct)
        return os.stat(filename).st_mtime * 10000

    return time.mktime(time.strptime(gs[0], "%Y-%m-%d")) * 10000 + int(gs[1])


class ShardingStrategyIsoDate(object):
    def get(self, timestamp):
        dt = datetime.datetime.utcfromtimestamp(timestamp / 1000)
        return dt.strftime("%Y-%m-%d")


class ShardingStrategy:
    @classmethod
    def make(cls):
        return ShardingStrategyIsoDate()


def write_migration_time_series(observation_accumulator, report_dir):
    observations = observation_accumulator.retrieve_all()

    migrations_path = os.path.join(report_dir, "migrations")
    if not os.path.exists(migrations_path):
        os.mkdir(migrations_path)

    # First get all unique migration ids
    ids = set()
    for observation in observations:
        ids.update(observation.migrations.keys())

    for mig_id in ids:
        mig_time_series = {
            "timeStamp": [],
            "migration": [],
        }
        for observation in observations:
            if mig_id in observation.migrations:
                mig_time_series["timeStamp"].append(observation.timeStamp)
                mig_time_series["migration"].append(observation.migrations[mig_id])

        migration_file = os.path.join(migrations_path, mig_id + ".gz")
        with gzip.open(migration_file, "wb") as rf:
            rf.write(json.dumps(mig_time_series).encode("utf-8"))


def process(args, observations, in_files, workspace, outdir):
    pool = multiprocessing.Pool(args.processes)

    try:
        for filename, file_observations in pool.imap(
            process_file, [(workspace, outdir, in_file) for in_file in in_files]
        ):
            observations.add(file_observations)
    finally:
        pool.close()


def build(workspace, observations, outdir):
    print("Writing reports", outdir)
    reporter = ReportBuilder(observations)
    ReportWriter().write(workspace.getReportDir(), reporter)

    write_migration_time_series(observations, workspace.getReportDir())

    print("Writing HTML")
    # Find where the script is being run from - public
    # directory should be in the same directory as the
    # script.
    script_home = os.path.dirname(os.path.abspath(__file__))
    public = os.path.join(script_home, "public")
    htdoc_generator = HtdocsGenerator(
        public_dir=public,
        workspace_dir=workspace.getDir(),
        www_dir=workspace.getHtmlDir(),
        data_dir=workspace.getDataDir(),
    )

    htdoc_generator.generate(outdir)


def run_server(
    HandlerClass=DefaultHandlerClass,
    ServerClass=DefaultServerClass,
    protocol="HTTP/1.0",
    bind=DEFAULT_WWW_BIND,
    port=DEFAULT_WWW_PORT,
):
    # NOTE: this is based on the test() server function provided in all http.server
    # python standard library implementations.  But that function is not
    # compatible between python versions (it suports various different
    # parameters e.g. port but not bind - so we can't rely on it)
    """
    Run the HTTP request handler class.

    This runs an HTTP server on the supplied bind address port
    default: 0.0.0.0:8000

    """
    server_address = (bind, port)

    HandlerClass.protocol_version = protocol
    httpd = ServerClass(server_address, HandlerClass)

    sa = httpd.socket.getsockname()
    print(
        "Serving HTTP on %s port %s (http://%s:%s/) ..." % (sa[0], sa[1], sa[0], sa[1])
    )
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nKeyboard interrupt received, exiting.")
        httpd.server_close()
        sys.exit(0)


def find_diagnostic_files(path):
    diagnostic_files = []
    for root, dirnames, filenames in os.walk(path):
        for file in fnmatch.filter(filenames, DIAGNOSTIC_LOG_FILE_PATTERN):
            # Ignore partially written log files.
            if file.endswith("tmp"):
                continue
            diagnostic_files.append(os.path.join(root, file))
    return diagnostic_files


def find_shard_files(path):
    shard_files = []
    for root, dirnames, filenames in os.walk(path):
        if SHARD_DIR_PATTERN.search(root):
            for filename in filenames:
                shard_files.append(os.path.join(root, filename))

    shard_files.sort()
    return shard_files


def extract_tarball(tarball, tarball_dir):
    print("Extracting tarball %s" % (tarball))
    if not os.path.exists(tarball_dir):
        os.makedirs(tarball_dir)

    file_obj = tarfile.open(tarball, "r")
    # Extract the diagnostic files.
    count = 0
    for member in file_obj:
        if fnmatch.fnmatch(os.path.basename(member.name), DIAGNOSTIC_LOG_FILE_PATTERN):
            file_obj.extract(member, tarball_dir)
            count = count + 1
            if count % 10 == 0:
                print("Extracted %d diagnostic files." % (count))

    file_obj.close()
    return find_diagnostic_files(tarball_dir)


def do_ingest(args):
    tarball_dir = os.path.join(
        args.www_directory, next(tempfile._get_candidate_names())
    )
    try:
        if args.tarball:
            # Need to extract tarball
            diagnostic_files = extract_tarball(args.tarball, tarball_dir)
            if len(diagnostic_files) == 0:
                raise Exception("No diagnostic files in tarball %s" % (args.tarball))

            print(
                "Tarball extraction complete, %d diagnostics files."
                % (len(diagnostic_files))
            )
            in_files = sorted(diagnostic_files, key=log_file_sort_key)
        else:
            in_files = sorted(args.files, key=log_file_sort_key)

        print("======================================================")
        print(" Outdir: %s" % args.www_directory)
        print(" Processes : %s" % args.processes)
        print("======================================================")
        sharder = ShardingStrategy.make()
        workspace = WorkspaceRepository(args.www_directory, args.ingest, sharder)
        workspace.mkdirs()
        observations = ObservationAccumulator()

        # Build up the observations from existing data set.
        if args.rebuild is not None:
            do_rebuild(args, observations, args.rebuild)

        if args.append is not None:
            do_rebuild(args, observations, args.append)

        # If we have incoming files process them - if rebuild
        # there will be no in_files
        if in_files:
            process(args, observations, in_files, workspace, args.ingest)

        # Now write summaries
        build(workspace, observations, args.ingest)
    finally:
        if os.path.exists(tarball_dir):
            shutil.rmtree(tarball_dir)


def do_rebuild(args, observations, dataset):
    shard_dir = os.path.join(args.www_directory, dataset, "data")
    shard_files = find_shard_files(shard_dir)
    pool = multiprocessing.Pool(args.processes)

    try:
        for filename, file_observations in pool.imap(
            load_file, [(in_file,) for in_file in shard_files]
        ):
            observations.add(file_observations)
    finally:
        pool.close()


def process_args(args):
    # This will re-write some options, in particular ingest
    check_ingest_args(args)
    check_rebuild_args(args)
    check_append_args(args)
    check_tarball_args(args)

    # check ingest


def check_ingest_args(args):
    if args.ingest is not None:
        # Protect against someone passing in a file path
        if args.ingest != os.path.basename(args.ingest):
            raise Exception("Ingest name %s cannot be a path." % (args.ingest))

    # check rebuild


def check_rebuild_args(args):
    if args.rebuild is not None:
        if (
            args.tarball is not None
            and args.ingest is not None
            and args.append is not None
        ):
            raise Exception(
                "If rebuild option is set then tarball, append and ingest options cannot be set."
            )

        if args.files:
            raise Exception(
                "rebuild option set to %s but extra files have been supplied."
                % (args.rebuild)
            )

        shard_dir = os.path.join(args.www_directory, args.rebuild, "data")
        if not os.path.exists(shard_dir):
            raise Exception(
                "Data set %s for option rebuild does not exist." % (args.rebuild)
            )
        args.ingest = args.rebuild

    # check append


def check_append_args(args):
    if args.append is not None:
        if args.ingest is not None:
            raise Exception("If append option is set then ingest cannot be set.")

        shard_dir = os.path.join(args.www_directory, args.append, "data")
        if not os.path.exists(shard_dir):
            raise Exception(
                "Data set %s for append operation does not exist." % (args.append)
            )
        args.ingest = args.append

    # check tarball


def check_tarball_args(args):
    if args.tarball is not None:
        if args.files:
            raise Exception(
                "tarball option set to %s but extra files have been supplied."
                % (args.tarball)
            )

        if (
            not args.tarball.endswith(".tar")
            and not args.tarball.endswith(".tar.gz")
            and not args.tarball.endswith(".tgz")
        ):
            raise Exception(
                "tarball %s must end in .tar or .tar.gz or .tgz" % (args.tarball)
            )

        if not os.path.exists(args.tarball):
            raise Exception("tarball %s does not exist." % (args.tarball))

        # if user has not provided a name for the data set then use the a name
        # based on the tarball name
        if args.ingest is None:
            filename = os.path.basename(args.tarball)
            if args.tarball.endswith(".tar"):
                args.ingest = filename[: -len(".tar")]
            if args.tarball.endswith(".tar.gz"):
                args.ingest = filename[: -len(".tar.gz")]
            if args.tarball.endswith(".tgz"):
                args.ingest = filename[: -len(".tgz")]


def main():
    workspace_dir = "python.workspace"
    parser = argparse.ArgumentParser()

    ###########################
    # ingest args
    ###########################
    default_processors = multiprocessing.cpu_count()
    parser.add_argument(
        "--processes",
        action="store",
        help="Number of processes to spawn. By default this will equal the core count of the host machine",
        default=default_processors,
        type=int,
    )
    parser.add_argument(
        "--ingest",
        dest="ingest",
        action="store",
        required=False,
        help="Ingest the diagnostics logs and store them under this name.",
    )
    parser.add_argument(
        "--tarball",
        dest="tarball",
        action="store",
        required=False,
        help="Use the provided tarball or talkback to extract the diagnostic logs.",
    )
    parser.add_argument(
        "--rebuild",
        dest="rebuild",
        action="store",
        required=False,
        help="Rebuild the reports for previously ingested diagnostics logs.",
    )
    parser.add_argument(
        "--append",
        dest="append",
        action="store",
        required=False,
        help="Append to an existing data set, the name of the data set must be provided.",
    )

    ###########################
    # www args
    ###########################
    parser.add_argument("--serve", dest="serve", action="store_true")
    parser.add_argument(
        "--www-bind",
        "-b",
        default=DEFAULT_WWW_BIND,
        metavar="ADDRESS",
        help="Specify alternate bind address " "[default: all interfaces]",
    )
    parser.add_argument(
        "--www-directory",
        action="store",
        default=workspace_dir,
        help="Specify alternate directory [default: cwd]",
    )
    parser.add_argument(
        "--www-port",
        "-p",
        default=DEFAULT_WWW_PORT,
        type=int,
        action="store",
        nargs="?",
        help="Specify alternate port [default: 8000]",
    )

    parser.add_argument("files", nargs="*")
    args = parser.parse_args()

    # if no args print README and exit
    if len(sys.argv) == 1:
        parser.print_help()
        sys.exit(0)

    # First do some args sanity.
    process_args(args)

    # do the ingest - at this stage if rebuild or append then ingest will also be
    # set.
    if args.ingest is not None:
        outdir = os.path.join(args.www_directory, args.ingest)
        if os.path.exists(outdir) and args.append is None and args.rebuild is None:
            print("Name %s exists already, skipping log processing." % (args.ingest))
        else:
            do_ingest(args)

    if args.serve:
        # serve from args.www_directory (or CWD if not set)
        DiagnosticsHttpServer.custom_dir = args.www_directory
        handler_class = DiagnosticsHttpServer

        if sys.version_info.major == 2:
            # self.headers.get_all() not supported in python 2.x.  patch it
            # to use a functionally equivalent method
            DiagnosticsHttpServer._header_get_all = (
                lambda self, header: self.headers.getallmatchingheaders(header)
            )

        # blocks
        run_server(HandlerClass=handler_class, port=args.www_port, bind=args.www_bind)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(1)
