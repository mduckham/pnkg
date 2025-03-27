# External libraries and dependencies 

###  RMLmapper-java 
[RMLMapper-java](https://github.com/RMLio/rmlmapper-java) executes RML rules and generates the Place Name Knowledge Graph (PNKG). 

#### Prerequisites for RMLmapper-java
* Java 17 is the minimum required version for compiling and running the current version of the project. <br>
* Development environments (IDEs) such as Visual Studio Code (VS Code), Eclipse IDE . <br>
* Apache Maven is required to be installed if you still need to install it. It can be done using [Homebrew](https://macpaw.com/how-to/install-maven-on-mac) .<br>

#### Installation steps 
* Clone the application from the [GitHub repository](https://github.com/RMLio/rmlmapper-java).  
* Build the application using the given command in the ReadMe file  (``` mvn install -DskipTests=true```  or  ```mvn test Dtest=!Mapper_OracleDB_Test```).
  
#### Execution
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

### PyRML
Python based engine for processing RML files. 
#### Prerequisites 
* Python 3; and
* Development environments (IDEs) such as Visual Studio Code(VS Code).
  
#### Installation steps 
* Clone the application from the [PyRML GitHub repository](https://github.com/anuzzolese/pyrml) <br>
* Alternatively, install the pyRML package directly from GitHub using the following command: 
pip install git+https://github.com/anuzzolese/pyrml

#### Execution
The following execution command should specify the relevant paths for the mapping and output files:
```
python converter.py [-o RDF out file] [-f RDF out file] [-m] input
```
Example:  
```
python converter.py -o artists_places.ttl -f turtle examples/artists/artist-map.ttl
``` 
Modify the execution command as needed, specifying the locations of the mapping file, and the destination for the output file. 

### Burp
[The Basic and Unassuming RML Processor (BURP)](https://github.com/kg-construct/BURP) is a reference implementation of the new RML specification, developed from scratch without influence from previous RML implementations.

#### Prerequisites 
* Java 17 is the minimum required version for compiling and running the current version of the project. <br>
* Development environments (IDEs) such as Visual Studio Code (VS Code), Eclipse IDE . <br>
* Apache Maven is required to be installed if you still need to install it. It can be done using Homebrew  (https://macpaw.com/how-to/install-maven-on-mac) .<br>

#### Installation steps 
* Clone the application from the [BURP GitHub repository](https://github.com/kg-construct/BURP).
* To build the project and copy its dependencies, execute ```mvn package``` and ```mvn dependency:copy-dependencies  ```
* Add ```-DskipTests``` after mvn package to skip the unit tests.

#### Execution
The following execution command should specify the relevant paths for the mapping and output files:
```
java -jar burp.jar [-h] [-b=<baseIRI>] -m=<mappingFile> [-o=<outputFile>]
``` 
Example: 
```
java -jar burp.jar -m=mapping.ttl -o=result.nq
```
Modify the execution command as needed, specifying the locations of the mapping file, and the destination for the output file.  

