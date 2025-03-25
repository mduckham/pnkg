# Source code
This folder contains the source code and scripts used in the RML mapping process.

## Data preprocessing 
Before executing the RML mapping script, the state and territory gazetteers underwent several steps in the data preprocessing stage.  

### Extracting data from Australian composite gazetteer

To extract the gazetteer from the [ICSM Australian Composite Gazetteer](https://placenames.fsdf.org.au/), you can use `./conversion/extract_from_ICSM.py`. Instructions and parameters provided in the [Python code](conversion/extract_from_icsm.py). 

### Geographic coordinates in WKT format

To add the WKT geometry, you can use `./conversion/convert_shp_WKT.py`. Instructions and parameters provoided in the [Python code](conversion/convert_shp_WKT.py).

### Other gazetter data formatting 

## RML mapping
