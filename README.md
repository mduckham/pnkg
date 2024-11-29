# semadaten

Geographic Knowledge Lab (GKL) semantic spatial data enrichment
Related to [OGC Code Sprint Nov 2024](https://www.ogc.org/ogc-events/the-november-2024-ogc-metadata-code-sprint/)

## Checklist
...


## Key resources 

- Geoscience Australia placenames ontology: 
[https://geoscienceaustralia.github.io/Placenames-Ontology/placenames.html](https://geoscienceaustralia.github.io/Placenames-Ontology/placenames.html)
- Geoscience Australia placenames GitHub: [https://github.com/GeoscienceAustralia/Placenames-Ontology](https://github.com/GeoscienceAustralia/Placenames-Ontology)
- Link to Place Names calogue and resources: [https://catalogue.linked.data.gov.au/resource/20](https://catalogue.linked.data.gov.au/resource/20)
- Composite Gazetteer of Australia: [https://placenames.fsdf.org.au/](https://placenames.fsdf.org.au/)
- Data Product Specification for the Composite Gazetteer of Australia: [Composite-Gazetteer-DPS.pdf](doc/Composite-Gazetteer-DPS.pdf)
- Linked Data API codebase for National Composite Gazetteer of Australia: [https://github.com/GeoscienceAustralia/placenames-dataset](https://github.com/GeoscienceAustralia/placenames-dataset)

## Structure of the repository

- **data**: 
    - Original datasets. This folder is ignored in .gitignore to avoid updates of large datasets. To update data, please, manually do it through the web interface.
- **doc**: 
    - Documentation, examples, 
- **lib**: 
    - External libraries
- **out**: 
    - Any output
- **src**: 
    - Code

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

- Data 
    - Directly available in the git:
        - NSW, QLD, SA, VIC, WA
    - To download:
        - SA: 
            - Option 1:
                - Use the link `https://www.dptiapps.com.au/dataportal/Gazetteer_geojson.zip`
                - Save in `./data/SA`
            - Option 2: with `wget`
                - Install the command wget: 
                    -`brew install wget`
                - Download the data:
                    - `wget -P ./data/SA https://www.dptiapps.com.au/dataportal/Gazetteer_geojson.zip`
    - Missing data:
        - NT, TAS
    - Tables of information can be under the formats: .csv, .dbf

- Source: 
    - From authoritative organisms (state) only and not from other non official provider
    - Informal resources: [ICSM](https://www.icsm.gov.au/individual-state-and-territory-gazetteers)


- Legend for the table:
	- DP: download page
	- DL: direct link to the dataset
	- API: URL of the API
	- Abbreviations:
		- **Abbv**: uploaded to the github (compressed file is <5-6 Mo, unzipped is around 25Mo).
		- *Abbv*: the compressed data is heavy to be shares with the github. As an alternative, we can download the data with `wget`. Regarding reproducibility aspects, this data might change throughout time.
		- Abbv: data not available.

| Abbv    | Description | Link                                                                                                                      | Data in github | Data to be downloaded | Downloaded |
| ------- | ----------- | ------------------------------------------------------------------------------------------------------------------------- | -------------- | --------------------- | ---------- |
| **NSW** | DP          | https://data.nsw.gov.au/data/dataset/geographical-name-register-of-nsw/resource/af4e95e2-0dda-44c4-9324-4a025169545c      | x              |                       | 15/11/2024 |
|         | DL          | https://dcok8xuap4.execute-api.ap-southeast-2.amazonaws.com/prod/public/placenames/geonames/download                      |                |                       |            |
|         | API         | (Not checked)                                                                                                             |                |                       |            |
| NT      | DP          | https://data.nt.gov.au/dataset/?q=names&sort=score+desc%2C+metadata_modified+desc                                         |                |                       |            |
|         | DL          | (no?)                                                                                                                     |                |                       |            |
|         | API         | (Not checked)                                                                                                             |                |                       |            |
| **QLD** | DP          | https://qldspatial.information.qld.gov.au/catalogue/custom/search.page?q=Place%20names%20gazetteer%20-%20Queensland       | x              |                       | 16/11/2024 |
|         | DL          | Request by email                                                                                                          |                |                       |            |
|         | API         | (Not checked)                                                                                                             |                |                       |            |
| *SA*    | DP          | https://data.sa.gov.au/data/dataset/gazetteer                                                                             |                | x                     |            |
|         | DL          | https://www.dptiapps.com.au/dataportal/Gazetteer_geojson.zip                                                              |                |                       |            |
|         | API         | (Not checked)                                                                                                             |                |                       |            |
| TAS     | DP          | No published data: https://listdata.thelist.tas.gov.au/opendata/                                                          |                |                       |            |
|         | DL          | (no)                                                                                                                      |                |                       |            |
|         | API         | https://nre.tas.gov.au/Documents/REST%20endoint%20User%20Notes.pdf                                                        |                |                       |            |
| **VIC** | DP          | https://maps.land.vic.gov.au/lassi/VicnamesUI.jsp                                                                         | x              |                       | 15/11/2024 |
|         | DL          | (no)                                                                                                                      |                |                       |            |
|         | API         | (Not checked)                                                                                                             |                |                       |            |
| **WA**  | DP          | https://catalogue.data.wa.gov.au/dataset/geographic-names-geonoma                                                         | x              |                       | 15/11/2024 |
|         | DL          | (Login required)                                                                                                          |                |                       |            |
|         | API         | (Not checked)                                                                                                             |                |                       |            |

## Ontologies

### Geoscience Australia placenames ontology

https://geoscienceaustralia.github.io/Placenames-Ontology/placenames.html


# How to use

- QLD
    - Convert SHP > JSON with `src/conversion/convert_shp_WKT.py` (modify the paths in the .py if required)
    - Execute `java -jar ./lib/rmlmapper-7.1.2-r374-all.jar -m ./src/QLD/pts.ttl -o ./out/QLD.rdf -s turtle` (modify the path if required)
    - The result is stored in `./out/QLD.rdf`


# Discussions

See in `/doc/README.md`