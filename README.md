# LiveData Migrator Diagnostics UI

Script will parse LiveData Migrator diagnostic logs and
talkbacks and create a UI.

```
usage: diagnostics-ui.py [-h] [--processes PROCESSES] [--ingest INGEST] [--tarball TARBALL] [--rebuild REBUILD] [--append APPEND]
                         [--serve] [--www-bind ADDRESS] [--www-directory WWW_DIRECTORY] [--www-port [WWW_PORT]]
                         [files ...]

positional arguments:
  files

options:
  -h, --help            show this help message and exit
  --processes PROCESSES
                        Number of processes to spawn. By default this will equal the core count of the host machine
  --ingest INGEST       Ingest the diagnostics logs and store them under this name.
  --tarball TARBALL     Use the provided tarball or talkback to extract the diagnostic logs.
  --rebuild REBUILD     Rebuild the reports for previously ingested diagnostics logs.
  --append APPEND       Append to an existing data set, the name of the data set must be provided.
  --serve
  --www-bind ADDRESS, -b ADDRESS
                        Specify alternate bind address [default: all interfaces]
  --www-directory WWW_DIRECTORY
                        Specify alternate directory [default: cwd]
  --www-port [WWW_PORT], -p [WWW_PORT]
                        Specify alternate port [default: 8000]

```

To process set of diagnostic logs and start web server, the diagnostic set can be identified as diag-set-1:

```
python3 diagnostics-ui.py --ingest diag-set-1 --serve talkback-LIVEDATA_MIGRATOR-20230509113117-diag.wandisco.com/livedata-migrator/logs/livedata-migrator/diagnostics.log talkback-LIVEDATA_MIGRATOR-20230509113117-diag.wandisco.com/livedata-migrator/logs/livedata-migrator/archived/diagnostics*
```

To process a talkback and start web server, diagnostic set will be identified as talkback-LIVEDATA_MIGRATOR-20230509113117-diag.wandisco.com as --ingress is not set

```
python3 diagnostics-ui.py --serve --tarball talkback-LIVEDATA_MIGRATOR-20230509113117-diag.wandisco.com.tar.gz
```

To start the web server and server existing data sets:

```
python3 diagnostics-ui.py --serve
```

By default directory used to store files is python.workspace in the current working directory.
