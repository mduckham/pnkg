# semadaten

Geographic Knowledge Lab (GKL) semantic spatial data enrichment
Related to [OGC Code Sprint Nov 2024](https://www.ogc.org/ogc-events/the-november-2024-ogc-metadata-code-sprint/)

## Checklist
...


## Structure of the repository

- **data**: original datasets. This folder is ignored in .gitignore to avoid updates of large datasets. To update data, please, manually do it through the web interface.
- **doc**: documentation, examples, 
- **lib**: external libraries
- **out**: any output
- **src**: code

## Installation

...

## Source datasets

- Extraction:
	- Date: 15/11/2024
	- Source: from authoritative organisms (state) and not from any non official provider

- Abbreviations:
	- DP: download page
	- DL: direct link to the dataset
	- API: URL of the API

| Abbv | Description | Link                                                                                                                      |
| ---- | ----------- | ------------------------------------------------------------------------------------------------------------------------- |
| NSW  | DP          | https://data.nsw.gov.au/data/dataset/geographical-name-register-of-nsw/resource/af4e95e2-0dda-44c4-9324-4a025169545c      |
|      | DL          | https://dcok8xuap4.execute-api.ap-southeast-2.amazonaws.com/prod/public/placenames/geonames/download                      |
|      | API         | ?                                                                                                                         |
| NT   | DP          |                                                                                                                           |
|      | DL          |                                                                                                                           |
|      | API         |                                                                                                                           |
| QLD  | DP          | https://www.qld.gov.au/environment/land/title/place-names/search                                                          |
|      | DL          | https://www.data.qld.gov.au/datastore/dump/414391b9-7943-4fc3-a237-a1ac57b75aab?bom=True                                  |
|      | API         | ?                                                                                                                         |
| SA   | DP          | https://data.sa.gov.au/data/dataset/gazetteer                                                                             |
|      | DL          | https://www.dptiapps.com.au/dataportal/Gazetteer_geojson.zip                                                              |
|      | API         | ?                                                                                                                         |
| TAS  | DP          | No published data: https://listdata.thelist.tas.gov.au/opendata/                                                          |
|      | DL          | (no)                                                                                                                      |
|      | API         | https://www.thelist.tas.gov.au/app/content/data/geo-meta-data-record?detailRecordUID=50e0ddfc-6638-4a8f-a965-7846d1924120 |
| VIC  | DP          | https://maps.land.vic.gov.au/lassi/VicnamesUI.jsp                                                                         |
|      | DL          | (no)                                                                                                                      |
|      | API         | ?                                                                                                                         |
| WA   | DP          | https://catalogue.data.wa.gov.au/dataset/geographic-names-geonoma                                                         |
|      | DL          | (Login required)                                                                                                          |
|      | API         |                                                                                                                           |

## Ontologies

### Geoscience Australia placenames ontology

https://geoscienceaustralia.github.io/Placenames-Ontology/placenames.html


## Problems / solutions