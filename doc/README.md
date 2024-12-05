# Discussions

- 18/11 - 9:00 - Warm-up  
    - Start first with pyRML 
    - Missing data for: 
        - Tasmania     
        - Northern Territories     
    - Tasks / goals: 
        - RML mapping for one state     
        - Download the metadata     
        - Sample the data per state    
        - Check if the ontology is the last one     
    - Outcomes for OGC: 
        - KG     
        - Nenad will ask Rob what he expects     
        - Day 1: 
            - One KG for one state     
            - Familiarise with the mapping via RDF       
        - Day 2: 
            - KG for the other states      

- 18/11 - 11:00 – Discussions after the presentation 
    - Pending questions  
        - ICSM:     
            - Any KG behind?       
            - Looks authoritative but is it ? Or should we use data from authoritative organisms?         
                - Point of view 1:     
                    - If documents with Nich Carr / Simon Cox-> more likely that there is an ontology behind?     
                    - Existing ontology on place names 
                - Point of view 2: 
                    -  Looks like a regular database 
            - What is the relationship between the data from ICSM and the gazetteers by the states? 
        - Define the ontology to be used 
    - Ideas: 
        - Basic metadata for each dataset / state  ->  and merge later data per state 
            

- 18/11- Discussions before lunch 
    - Different existing ontologies: 
        - Place names in Australia (Geosciences) 
        - Geonames 
        - United Nations 
        - Europe (INSPIRE) 
    - Future difficulties: 
        - Mapping geometies 
        - RML does not recognise certain formats (ex: WKT) 

- 18/11 - Discussions after lunch 
    - Choices: 
        - Dataset: South Australia 
        - Ontology: Place names in Australia (Geosciences) 

- 18/11 - End of the day 
    - Write one subject per class (ex: geometry will be one subject) 
    - Code: 
        - Better to write one header for the logical source 
        - Most advanced versions: Ozzy / Nayomi -> push on the git 
        - Convert the GeoJSON into WKT throught geopandas 

- 19/11 - Morning warm-up 
    - What what has been done yesterday: 
        - Place name ontology: 
            - Class = subject 
        - PyRML 
            - Missing functions but we could use a mapping with the prefixes 
            - In Java, we can mention the functions
        - Each class is a subject map 
    - Missing: 
        - Functions for geometry (conversion from GeoJSON into WKT) 
    - Other dataset: 
        - Whole Australia 
    
Issues on using place names ontology: 
1. Dcterms:agent    how to create an instance of it, what are the requied data properties  
2. PlaceType.   it's also abstract 
3. How to determine if a placename is official or not  
4. We need an agreed base URI 
5. Mappinng Geometry coordinates