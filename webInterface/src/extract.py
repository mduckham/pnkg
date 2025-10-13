from rdflib import Graph, Namespace
from rdflib.namespace import RDF

goi = "/Users/ozzy/Projects/knowledge_graph_online/pnkg20250815.ttl"
g = Graph()

g.parse(goi, format="turtle") 

# Define the geo namespace
geo = Namespace("http://www.opengis.net/ont/geosparql#")

# Method 1: Query for all instances of geo:Geometry using SPARQL
print("=== All geo:Geometry instances ===")
qres = g.query(
    """
    PREFIX geo: <http://www.opengis.net/ont/geosparql#>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
    
    SELECT ?geometry ?wkt
    WHERE {
    ?feature geo:hasGeometry ?geometry.
        ?geometry geo:asWKT ?wkt .
    }
    """
)

import pandas as pd

# Convert SPARQL results to pandas DataFrame
results = []
for row in qres:
    results.append({
        'id': str(row.geometry),
        'wkt': str(row.wkt)
    })
    
df = pd.DataFrame(results)

import geopandas as gpd
from shapely import wkt as shapely_wkt

# Convert WKT strings to shapely geometries
df['geometry'] = df['wkt'].apply(shapely_wkt.loads)

# Convert to GeoDataFrame
gdf = gpd.GeoDataFrame(df, geometry='geometry', crs='EPSG:4326')

# save to geojson
gdf.to_file('placenames.geojson', driver='GeoJSON')






