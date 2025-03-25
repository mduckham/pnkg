#!/usr/bin/env python
# -*-coding:utf-8 -*-

################################################################################
"""
This file adds a WKT attribute to SHP / GeoJSON files

- Comment / uncomment the option you want
- Modify the paths
- Execute
"""
################################################################################
#------------------
# GENERAL MODULES
import os, sys
from IPython.core.ultratb import ColorTB
import geopandas as gpd

sys.excepthook = ColorTB()

#------------------
# PATHS
WKSPACE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.append(WKSPACE)

################################################################################
# PARAMS
################################################################################

#---------------------------------
# Option 1: input path in SHP
#---------------------------------
# Relative path to shp (for which we want to add the WKT geometry)
path_shp = "./data/QLD/QSC_Extracted_Data_20241116_091529762538-17764/Place_names_gazetteer.shp"

# Absolute path
path_shp = os.path.join(
    WKSPACE,
    path_shp,
)
path_export = path_shp.replace(
    ".shp", 
    "_wkt.csv",
)

#---------------------------------
# Option 2: input path in GeoJSON >>> the file will be converted into a SHP in first
#---------------------------------
path_geojson = "/Users/alexis/Documents/04_Code/semadaten/data/SA/SA_Gazetteer_geojson/GazetteerAreas_GDA94.geojson"
path_shp = path_geojson.replace(
    ".geojson", 
    ".shp",
)

gdf = gpd.read_file(path_geojson)
gdf.to_file(path_shp)

################################################################################

def convert_shp_to(
        path_import,
        path_export,
        format="json",
    ):

    data_shp = gpd.read_file(
        filename=path_import,
    )

    data_shp = data_shp.to_crs(4326)

    print(f"CRS: {data_shp.crs}")
    data_wkt = data_shp.to_wkt()
    if format=="json":
        data_wkt = data_wkt.to_json(
            orient="records", 
            indent=4,
            force_ascii=False,
        )
    if format=="csv":
        data_wkt = data_wkt.to_csv(
            # force_ascii=False
        )

    with open(path_export, 'w', encoding="utf-8") as file:
        file.write(data_wkt)

################################################################################

if __name__ == "__main__":

    path_export = path_shp.replace(
        ".shp", 
        "_wkt.csv",
    )

    convert_shp_to(
        format="csv",
        path_import=path_shp,
        path_export=path_export,
    )
