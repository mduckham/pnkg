#!/usr/bin/env python
# -*-coding:utf-8 -*-

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

#---------------------------------
# path_shp = "./data/QLD/QSC_sample_Extracted_Data_20241116_091529762538-17764/QSC_sample_Place_names_gazetteer.shp"

path_shp = "./data/QLD/QSC_Extracted_Data_20241116_091529762538-17764/Place_names_gazetteer.shp"


path_shp = os.path.join(
    WKSPACE,
    path_shp,
)
path_export = path_shp.replace(".shp", "_wkt.json")

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
    convert_shp_to(
        format="json",
        path_import=path_shp,
        path_export=path_export,
    )
