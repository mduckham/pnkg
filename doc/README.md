# Documentation

## Place Name ontology 
Important documentation about place name ontology is available on the Place Name Ontology [webpage](https://geoscienceaustralia.github.io/Placenames-Ontology/placenames.html) and [GitHub repository](https://github.com/GeoscienceAustralia/Placenames-Ontology). In the figure below, yellow circles represent classes, blue rectangles indicate object properties, and green rectangles depict data properties.

![Place Name Ontology Diagram](placename-ontology.png)
   
## RDF Mapping Language (RML)

Description, specificaiton, vocabulary, and examples related to RML language can be found in this [document](https://rml.io/specs/rml/). RML processors, tools, and dependencies can be found on the following [GitHub webpage](https://github.com/RMLio). 

### Useful resources
* [RML: A Generic Language for Integrated RDF Mappings of Heterogeneous Data](https://citeseerx.ist.psu.edu/document?repid=rep1&type=pdf&doi=f0b98c4fc3a542a83349666f4073359ed56d1a17)
* [The RML Ontology: A Community-Driven Modular Redesign After a Decade of Experience in Mapping Heterogeneous Data to RDF](https://link.springer.com/content/pdf/10.1007/978-3-031-47243-5_9.pdf)

### Example
```ttl
@prefix ql: <http://semweb.mmlab.be/ns/ql#> .
@prefix rml: <http://semweb.mmlab.be/ns/rml#> .
@prefix rr: <http://www.w3.org/ns/r2rml#> .
@prefix xml: <http://www.w3.org/XML/1998/namespace> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix pa: <http://linked.data.gov.au/def/placenames/> .
@prefix pnkg: <http://geosensor.net/ns/pnkg#>.
@base <http://geosensor.net/ns/pnkg#>.

<#DataSource_WA> a rml:LogicalSource;
    rml:source "../Data/WA.csv";
    rml:referenceFormulation ql:CSV .

<#PlaceNameMapping> a rr:TriplesMap;
    rml:logicalSource <#DataSource_WA>;
    rr:subjectMap [
        rr:template "http://geosensor.net/ns/pnkg/PlaceName/{state}/{feature_number}";
        rr:class pa:OfficialPlaceName;
    ];

    rr:predicateObjectMap [
        rr:predicate pa:dateReleased;
        rr:objectMap [
            rml:reference "date_approved";
            rr:datatype xsd:date;
        ]
    ];
    rr:predicateObjectMap [
        rr:predicate pa:name;
        rr:objectMap [
            rml:reference "geographic_name";
             rr:datatype xsd:string;
        ]
    ].
```

The above code snippet creates triples for place name instances of the *OfficialPlaceName* class in the PlaceName ontology.  
* Logical source declaration
    
    ```ttl
     <#DataSource> a rml:LogicalSource;
          rml:source "../Data/WA.csv";
          rml:referenceFormulation ql:CSV .
    ```

  *rml:logicalSource* points to a source that contains the data to be mapped.
  
* Triples map for *PlaceName* <br>
It consists of three distinct components: a Logical Source, a Subject Map, and zero or more Predicate-Object Maps, which are used to define rules to transform each row of the data source into RDF triples. <br>
The above example defines mappings to create instances of the *OfficialPlaceName* class in the PlaceName Ontology. The *date_approved* and *geographic_name* columns in the CSV file are mapped to the *dateReleased* and *name* data properties of instances of the *OfficialPlaceName* class in the PlaceName Ontology.

#### Output
```ttl
<http://geosensor.net/ns/pnkg/PlaceName/WA/100194424> <http://linked.data.gov.au/def/placenames/name> "MAUDS LANDING" .
<http://geosensor.net/ns/pnkg/PlaceName/WA/100194424> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://linked.data.gov.au/def/placenames/OfficialPlaceName> .
<http://geosensor.net/ns/pnkg/PlaceName/WA/100194425> <http://linked.data.gov.au/def/placenames/dateReleased> "2005-01-11"^^<http://www.w3.org/2001/XMLSchema#date> .
<http://geosensor.net/ns/pnkg/PlaceName/WA/100194425> <http://linked.data.gov.au/def/placenames/name> "CORAL BAY" .
<http://geosensor.net/ns/pnkg/PlaceName/WA/100194425> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://linked.data.gov.au/def/placenames/OfficialPlaceName> .
<http://geosensor.net/ns/pnkg/PlaceName/WA/100194445> <http://linked.data.gov.au/def/placenames/dateReleased> "2004-12-10"^^<http://www.w3.org/2001/XMLSchema#date> .
<http://geosensor.net/ns/pnkg/PlaceName/WA/100194445> <http://linked.data.gov.au/def/placenames/name> "MONTEBELLO ISLANDS MARINE PARK" .
<http://geosensor.net/ns/pnkg/PlaceName/WA/100194445> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://linked.data.gov.au/def/placenames/OfficialPlaceName> .
<http://geosensor.net/ns/pnkg/PlaceName/WA/100194468> <http://linked.data.gov.au/def/placenames/dateReleased> "2004-12-10"^^<http://www.w3.org/2001/XMLSchema#date> .
```
The above RDF snippet represents a fragment of the RDF output related to the PlaceName mapping.


     
    
