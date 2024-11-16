# semadaten

Geographic Knowledge Lab (GKL) semantic spatial data enrichment
Related to [OGC Code Sprint Nov 2024](https://www.ogc.org/ogc-events/the-november-2024-ogc-metadata-code-sprint/)

## Checklist
...


## Structure of the repository

- **data**: original datasets. This folder is ignored in .gitignore to avoid updates of large datasets. To update data, please, manually do it through the web interface.
- **doc**: documentation, examples, 
- **lib**: external libraries
- **out**: any output
- **src**: code

## Installation
### RML Processors
###  rmlmapper java 
#### Prerequisites 
* Java 17 is the minimum required version for compiling and running the current version of the project. <br>
* Development environments (IDEs) such as Visual Studio Code (VS Code), Eclipse IDE . <br>
* Apache Maven is required to be installed if you still need to install it. It can be done using Homebrew  (https://macpaw.com/how-to/install-maven-on-mac) .<br>
#### Steps 
* Clone the application from the GitHub repository (https://github.com/RMLio/rmlmapper-java ) 
* Build the application using the given command in the ReadMe file  (``` mvn install -DskipTests=true```  or  ```mvn test Dtest=!Mapper_OracleDB_Test```) 
##### Command to execute the mapping file 
```java -jar ./target/jarFile -m mappingFile.ttl -o output.ttl``` <br>
The relevant paths of the mapping and output files should be mentioned in the command. 

### PyRML 
#### Prerequisites 
* Python 3
* Development environments (IDEs) such as Visual Studio Code(VS Code) 
#### Steps 
* Clone the application from the GitHub repository (https://github.com/anuzzolese/pyrml) <br>
   Alternatively, it is possible to install the pyRML package directly from GitHub in the following way: 
pip install git+https://github.com/anuzzolese/pyrml 
##### Command to execute the mapping file
```python converter.py [-o RDF out file] [-f RDF out file] [-m] input ``` <br>
Example: - 
```python converter.py -o artists_places.ttl -f turtle examples/artists/artist-map.ttl ```
<br>The relevant paths of the mapping and output files should be mentioned in the command.

### Burp
#### Prerequisites 
* Java 17 is the minimum required version for compiling and running the current version of the project. <br>
* Development environments (IDEs) such as Visual Studio Code (VS Code), Eclipse IDE . <br>
* Apache Maven is required to be installed if you still need to install it. It can be done using Homebrew  (https://macpaw.com/how-to/install-maven-on-mac) .<br>
#### Steps 
* Clone the application from the GitHub repository (https://github.com/kg-construct/BURP )
* To build the project and copy its dependencies, execute <br>
```mvn package``` <br>
```mvn dependency:copy-dependencies  ``` <br>
You can add ```-DskipTests``` after mvn package to skip the unit tests.
##### Command to execute the mapping file
```java -jar burp.jar [-h] [-b=<baseIRI>] -m=<mappingFile> [-o=<outputFile>] ``` <br>
Example:- 
```java -jar burp.jar -m=mapping.ttl -o=result.nq ``` <br>
The relevant paths of the mapping and output files should be mentioned in the command. 
<br>

## Source datasets

- Extraction:
	- Date: 15/11/2024
	- Source: from authoritative organisms (state) and not from any non official provider

- Abbreviations:
	- DP: download page
	- DL: direct link to the dataset
	- API: URL of the API

| Abbv | Description | Link                                                                                                                      |
| ---- | ----------- | ------------------------------------------------------------------------------------------------------------------------- |
| NSW  | DP          | https://data.nsw.gov.au/data/dataset/geographical-name-register-of-nsw/resource/af4e95e2-0dda-44c4-9324-4a025169545c      |
|      | DL          | https://dcok8xuap4.execute-api.ap-southeast-2.amazonaws.com/prod/public/placenames/geonames/download                      |
|      | API         | ?                                                                                                                         |
| NT   | DP          |                                                                                                                           |
|      | DL          |                                                                                                                           |
|      | API         |                                                                                                                           |
| QLD  | DP          | https://www.qld.gov.au/environment/land/title/place-names/search                                                          |
|      | DL          | https://www.data.qld.gov.au/datastore/dump/414391b9-7943-4fc3-a237-a1ac57b75aab?bom=True                                  |
|      | API         | ?                                                                                                                         |
| SA   | DP          | https://data.sa.gov.au/data/dataset/gazetteer                                                                             |
|      | DL          | https://www.dptiapps.com.au/dataportal/Gazetteer_geojson.zip                                                              |
|      | API         | ?                                                                                                                         |
| TAS  | DP          | No published data: https://listdata.thelist.tas.gov.au/opendata/                                                          |
|      | DL          | (no)                                                                                                                      |
|      | API         | https://www.thelist.tas.gov.au/app/content/data/geo-meta-data-record?detailRecordUID=50e0ddfc-6638-4a8f-a965-7846d1924120 |
| VIC  | DP          | https://maps.land.vic.gov.au/lassi/VicnamesUI.jsp                                                                         |
|      | DL          | (no)                                                                                                                      |
|      | API         | ?                                                                                                                         |
| WA   | DP          | https://catalogue.data.wa.gov.au/dataset/geographic-names-geonoma                                                         |
|      | DL          | (Login required)                                                                                                          |
|      | API         |                                                                                                                           |

## Ontologies

### Geoscience Australia placenames ontology

https://geoscienceaustralia.github.io/Placenames-Ontology/placenames.html


## Problems / solutions
