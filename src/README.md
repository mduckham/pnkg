# Source code
This folder contains the source code and scripts used in the RML mapping process.

## Data preparation
Before executing the RML mapping script, the state and territory gazetteers underwent several steps in the data preprocessing stage.  

### Extracting data from the Australian composite gazetteer

To extract the gazetteer from the [ICSM Australian Composite Gazetteer](https://placenames.fsdf.org.au/), you can use `./conversion/extract_from_ICSM.py`. Instructions and parameters provided in the [Python code](conversion/extract_from_icsm.py). 

### Geographic coordinates in WKT format

To add the WKT geometry, you can use `./conversion/convert_shp_WKT.py`. Instructions and parameters are provided in the [Python code](conversion/convert_shp_WKT.py). The [requirements.txt](conversion/requirements.txt) file includes the dependencies and packages required to run the Python code. 

### Gazetteer data formatting 

- NSW
  - A new column (GAZETTE DATE FORMATTED) was added to record the converted date after removing unnecessary text segments.
  - Added a new column to record the state's abbreviation (NSW)
- ACT, TAS, NT
  - Added a new column to record each state's abbreviation (ACT,TAS, NT)
- SA (Sites)
  - Renamed (feature_category, feature_type, feature_sub_type) as (feature_group, feature_category, feature_type) since the existing values did not align with the definitions of the ICSM Permanent Committee on Place Names
  - Added a new column to record “status” as gazetted
- QLD & WA
  - Added a new column to record the state's abbreviation (QLD)
  - Added a new column to record “status” as gazetted
- VIC (Places)
  - Added “IsIndigenous” column; for example, if the "Aboriginal Origins" column contains "Aboriginal Name," then the "IsIndigenous" column is set to TRUE; otherwise, it is set to FALSE.

## RML mapping and processing

RML mapping rules are written and included in [place name mapping file](AusPlaceNameMapping20250325.ttl). 
The following execution command should specify the relevant paths for the mapping and output files:
 ``` 
java -jar ./target/jarFile -m mappingFile.ttl -o output.ttl
 ``` 
The target location of each data source file in the RML mapping file must be updated to match the correct file paths on your local machine.
Example: 
<pre><#ACTSitesSource> a rml:LogicalSource;
      rml:source "../Data/ACT.csv";  
      rml:referenceFormulation ql:CSV .</pre>
Modify the execution command as needed, specifying the locations of the JAR file, mapping file, and the destination for the output file. 
Example:
```
java -jar ./lib/rmlmapper-17.0.0-r449-all.jar -m ./src/PlaceNameKGAus/RML/PlaceNameMapping.ttl -o ./src/PlaceNameKGAus/out/pnkg_out.ttl
```
The PNKG in ttl file format will be stored in ```./src/PlaceNameKGAus/out/pnkg_out.ttl```
In this project, the knowledge graph was built using [RMLmapper-java](lib/README.md). Alternatively, other RML processors, such as [PyRML and BURP](lib/README.md), can be used to construct the PNKG. 
