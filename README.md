# semadaten

Geographic Knowledge Lab (GKL) semantic spatial data enrichment
Related to [OGC Code Sprint Nov 2024](https://www.ogc.org/ogc-events/the-november-2024-ogc-metadata-code-sprint/)

## Checklist
...


## Structure of the repository

- **data**: 
    - Original datasets. This folder is ignored in .gitignore to avoid updates of large datasets. To update data, please, manually do it through the web interface.
- **doc**: 
    - Documentation, examples, 
- **lib**: 
    - External libraries
- **out**: 
    - Any output
- **src**: 
    - Code

## Installation

...

## Source datasets

- Data 
    - Directly available in the git:
        - NSW, QLD, SA, VIC, WA
    - To download:
        - SA: 
            - Option 1:
                - Use the link `https://www.dptiapps.com.au/dataportal/Gazetteer_geojson.zip`
                - Save in `./data/SA`
            - Option 2: with `wget`
                - Install the command wget: 
                    -`brew install wget`
                - Download the data:
                    - `wget -P ./data/SA https://www.dptiapps.com.au/dataportal/Gazetteer_geojson.zip`
    - Missing data:
        - NT, TAS
    - Tables of information can be under the formats: .csv, .dbf

- Source: 
    From authoritative organisms (state) only and not from other non official provider

- Legend for the table:
	- DP: download page
	- DL: direct link to the dataset
	- API: URL of the API
	- Abbreviations:
		- **Abbv**: uploaded to the github (compressed file is <5-6 Mo, unzipped is around 25Mo).
		- *Abbv*: the compressed data is heavy to be shares with the github. As an alternative, we can download the data with `wget`. Regarding reproducibility aspects, this data might change throughout time.
		- Abbv: data not available.

| Abbv    | Description | Link                                                                                                                      | Data in github | Data to be downloaded | Downloaded |
| ------- | ----------- | ------------------------------------------------------------------------------------------------------------------------- | -------------- | --------------------- | ---------- |
| **NSW** | DP          | https://data.nsw.gov.au/data/dataset/geographical-name-register-of-nsw/resource/af4e95e2-0dda-44c4-9324-4a025169545c      | x              |                       | 15/11/2024 |
|         | DL          | https://dcok8xuap4.execute-api.ap-southeast-2.amazonaws.com/prod/public/placenames/geonames/download                      |                |                       |            |
|         | API         | (Not checked)                                                                                                             |                |                       |            |
| NT      | DP          | https://data.nt.gov.au/dataset/?q=names&sort=score+desc%2C+metadata_modified+desc                                         |                |                       |            |
|         | DL          | (no?)                                                                                                                     |                |                       |            |
|         | API         | (Not checked)                                                                                                             |                |                       |            |
| **QLD** | DP          | https://qldspatial.information.qld.gov.au/catalogue/custom/search.page?q=Place%20names%20gazetteer%20-%20Queensland       | x              |                       | 16/11/2024 |
|         | DL          | Request by email                                                                                                          |                |                       |            |
|         | API         | (Not checked)                                                                                                             |                |                       |            |
| *SA*    | DP          | https://data.sa.gov.au/data/dataset/gazetteer                                                                             |                | x                     |            |
|         | DL          | https://www.dptiapps.com.au/dataportal/Gazetteer_geojson.zip                                                              |                |                       |            |
|         | API         | (Not checked)                                                                                                             |                |                       |            |
| TAS     | DP          | No published data: https://listdata.thelist.tas.gov.au/opendata/                                                          |                |                       |            |
|         | DL          | (no)                                                                                                                      |                |                       |            |
|         | API         | https://www.thelist.tas.gov.au/app/content/data/geo-meta-data-record?detailRecordUID=50e0ddfc-6638-4a8f-a965-7846d1924120 |                |                       |            |
| **VIC** | DP          | https://maps.land.vic.gov.au/lassi/VicnamesUI.jsp                                                                         | x              |                       | 15/11/2024 |
|         | DL          | (no)                                                                                                                      |                |                       |            |
|         | API         | (Not checked)                                                                                                             |                |                       |            |
| **WA**  | DP          | https://catalogue.data.wa.gov.au/dataset/geographic-names-geonoma                                                         | x              |                       | 15/11/2024 |
|         | DL          | (Login required)                                                                                                          |                |                       |            |
|         | API         | (Not checked)                                                                                                             |                |                       |            |

## Ontologies

### Geoscience Australia placenames ontology

https://geoscienceaustralia.github.io/Placenames-Ontology/placenames.html


## Problems / solutions

...