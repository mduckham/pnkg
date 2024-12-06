# %%
import geopandas as gpd
import pandas as pd
from shapely.geometry import Point


# %%
df = pd.read_csv('./VIC_241115_Roads.csv', sep=',' , encoding='latin-1', index_col=False)

# %%
df.columns

# %%

# store wkt in a list
wkt_list = []

for i, r in df.iterrows():
    lon = r['Longitude']
    lat = r['Latitude']

    wkt_list.append(Point(lon, lat).wkt)

# %%
len(wkt_list), wkt_list[0]

# %%
df['WKT'] = wkt_list

# %%
df.head()

# %%
df.to_csv('VIC_241115_Roads_with_wkt.csv')

# %%
