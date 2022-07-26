# UI for displaying LiveData Migrator Diagnostics

This is a tool for visualizing Diagnostics from 
WANDisco LiveData Migrator. The tool takes the
diagnostic logs, processes them and then generates
charts that can be viewed in a browser. The tool
uses node.js.


Install node.js

Run the following to download the required Javascript Libraries
```
npm install
```

Run:
```
node app.js
```
This will run with the provided example diagnostic file.


To generate an input file in the correct format take log files from
an installation and run the diagnotic_parser script, see

https://github.com/WANdisco/livedata-migrator-scripting/tree/main/parsers

If there are multiple GB of diagnostic logs then the script will take
some time to run. The script processes files across multiple threads.

```
/diagnostic_parser.py diagnostic.log ./archive/diagnostic*.gz | gzip > diagnostics.formatted.gz
```

This command can take a long time if the diagnostics are huge.

```
node app.js diagnostics.formatted.gz [port]
```

This can take a long time as the diagnostics are processed, they are cached in 
the workspace directory. If you run again with the same file it will not need to
be processed as the cached data will be used.

TODO:
* Could have the diagnostic parser script generate the 
  cached workspace files. Its already need to get the raw
  logs into a format that can be consumed here, it could be a
  command line option.
* Have a per migration page, showing time graphs of a single migration (
  pending regions, action's etc). This should be linked from the 
  migrations page, and also any migration id displayed (eg active transfers) 
  should link to the page as well.
* More tooltips to explain graphs and tables.
* Display Linux pressure if the data is available.
* Add Inotify page with graphs of Inotify behaviour.
* Support upload of diagnostic file.
* Add peak bandwdith.
* Tidy up CSS and tables.
* Add peaks to index table - what was peak retransmits, pending regions etc, 
  allow click on entry to take you to that point in time.
* Add migration count and state to index table.
* Add Inotify stuff to index table.
* Clean up Javascript - hoist vars to start of blocks.
* EventManager Max Time graph is log scale, can cause problems if value is zero,
  make log/linear a button.
