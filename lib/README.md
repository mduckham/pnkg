# External libraries and dependencies 

###  RMLmapper-java 
[RMLMapper](https://github.com/RMLio/rmlmapper-java) has been used as the RML processor to generate linked data using RML rules

#### Prerequisites for RMLmapper-java
* Java 17 is the minimum required version for compiling and running the current version of the project. <br>
* Development environments (IDEs) such as Visual Studio Code (VS Code), Eclipse IDE . <br>
* Apache Maven is required to be installed if you still need to install it. It can be done using [Homebrew](https://macpaw.com/how-to/install-maven-on-mac) .<br>

## Other RML processors 
### PyRML 
#### Prerequisites 
* Python 3
* Development environments (IDEs) such as Visual Studio Code(VS Code) 
#### Steps 
* Clone the application from the [PyRML GitHub repository](https://github.com/anuzzolese/pyrml) <br>
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
* Clone the application from the [BURP GitHub repository](https://github.com/kg-construct/BURP)
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
