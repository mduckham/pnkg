#!/usr/bin/env python
# -*-coding:utf-8 -*-

################################################################################
"""
Some gazetteers are missing in the data catalogue from each state.
Instead, data exist in the national gazetteer of Australia (ICSM). This program extracts
the gazetteer from each state from this national gazetteer.

You must:
- Download the whole gazetteer (format .gpkg) and modify {path_icsm}
- Modify the paths (if needed) and the parameters

Just execute the program normally.
"""


################################################################################

import geopandas
import sys
from IPython.core.ultratb import ColorTB
import os, sys
import pandas as pd
import json

sys.excepthook = ColorTB()

#------------------
# PATHS
WKSPACE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.append(WKSPACE)


################################################################################

#---------------------------------
# Paths / Params
#---------------------------------

state_to_extract = "ACT"

# Path to the ICSM (downloaded from the national gazetteer) in the format .gpkg
path_icsm = "/Users/alexis/Documents/04_Code/semadaten/data/ALL/PlaceNames.gpkg"

# Output folder
path_ACT_folder = os.path.join(
    WKSPACE,
    "./data/ACT/",
)

# Output CSV
path_export_csv = os.path.join(
    WKSPACE,
    path_ACT_folder,
    "ACT_241206.csv",
)

# Output JSON
path_export_json = path_export_csv.replace(".csv", ".json")

################################################################################

class Gazetteer_from_ICSM:

    #---------------------------------
    def __init__(
            self,
        ):

        self.data = None

    #---------------------------------
    def import_gpkg_from_icsm(
            self,
            path_input:str,
        ):
        
        self.data = geopandas.read_file(
            path_input, 
        )

    #---------------------------------
    def filter_state(
            self,
            state:str,
            column_name="AUTHORITY",
            file_output:str=None,
        ):

        gdf_filtered = self.data[self.data[column_name] == state]

        # print(gdf_filtered.head())
    
        if file_output is not None:
            gdf_filtered.to_csv(
                file_output, 
                index=False, 
                mode='w',
            )

    #---------------------------------
    def export_csv_to_json(
            self,
            path_input,
            path_export,
        ):
        
        data = pd.read_csv(path_input)
        data = data.to_json(orient="records")
        with open(path_export, "w", encoding="utf-8") as file:
            # json.dumps(data, file, indent=4)
            file.write(data)

        with open(path_export, "r", encoding="utf-8") as file:
            data = json.load(file)

        with open(path_export, "w", encoding="utf-8") as file:
            json.dump(data, file, indent=4)
        

################################################################################

if __name__ == "__main__":

    if not os.path.exists(path_ACT_folder):
        os.mkdir(path_ACT_folder)

    print(path_ACT_folder)
    print(path_export_csv)

    #---------------------------------
    # Extraction
    #---------------------------------
    Gazetteer = Gazetteer_from_ICSM()
    Gazetteer.import_gpkg_from_icsm(
        path_input=path_icsm,
    )

    Gazetteer.filter_state(
        state=state_to_extract,
        file_output=path_export_csv,
    )

    Gazetteer.export_csv_to_json(
        path_input=path_export_csv,
        path_export=path_export_json,
    )
