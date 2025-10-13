# Australian placenames knowledge graph

## Transforming Knowledge Graph Geospatial Data for Web-Based Visualization
1. Transform the knowledge graph (TTL) file into a GeoJSON file
   
   The knowledge graph represented in Turtle (TTL) format was converted into a GeoJSON format containing only the geometric data. The resulting GeoJSON includes two fields: "id", which represents the URI of the geometry, and "wkt", which stores the geometry value in Well-Known Text (WKT) format.
   
2. Generate MBTiles

   Subsequently, the generated GeoJSON file was processed using Tippecanoe(https://github.com/mapbox/tippecanoe?tab=readme-ov-file), a command-line tool for creating vector tilesets from GeoJSON data. The following command was executed:
   
    To install tippecanoe
      ``` 
      brew install tippecanoe 
      ```
    To generate mbtiles file
    
      ``` 
      tippecanoe -zg \
        -o placenames.mbtiles \
        -l placenames \
        --exclude-all --include=id \
        --generate-ids \
        --extend-zooms-if-still-dropping \
        placenames.geojson
      ```

3. Convert MBTiles to PMTiles
   Since, PMTiles can be hosted directly on an AWS web server without needing a dedicated tile server, PMTiles file was created using the MBTiles file.
     ```
     pmtiles convert placenames.mbtiles placenames.pmtiles
     ```
   
