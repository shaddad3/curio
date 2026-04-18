import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
import duckdb
import time
import os
import sys
from memory_profiler import memory_usage

# --- CONFIGURATION ---
# Point this to any real-world dataset in the curio/docs/examples/data folder
DATA_PATH = "docs/examples/data/Green_Roofs.csv" 
# Provide a column name to test DuckDB's filter pushdown capability
# (Adjust this to match an actual column in your chosen CSV, e.g., "BUILDING TYPE")
FILTER_COLUMN = "TOTAL_ROOF_SQFT" 
FILTER_VALUE = 251665  # Dummy filter value, adjust based on the dataset

if not os.path.exists(DATA_PATH):
    raise FileNotFoundError(f"Cannot find {DATA_PATH}. Please run from the repo root.")

# Load the real dataset into memory (simulating the output of an initial data-loading node)
print(f"Loading real-world dataset: {DATA_PATH}")
df_real = pd.read_csv(DATA_PATH)
print(f"Dataset Shape: {df_real.shape}")
print("-" * 50)

# ---------------------------------------------------------
# SCENARIO 1: OLD SYSTEM (JSON String Transfer)
# ---------------------------------------------------------
def old_system_full_transfer(df):
    # Node 1: Serialize to JSON string (Network/IPC payload)
    json_payload = df.to_json(orient='records')
    
    # Node 2: Deserialize from JSON string back to DataFrame
    df_received = pd.read_json(json_payload, orient='records')
    return json_payload, df_received

def old_system_filtered(df, col, val):
    # Must serialize/deserialize the ENTIRE dataset before filtering
    json_payload = df.to_json(orient='records')
    df_received = pd.read_json(json_payload, orient='records')
    
    # Filter happens in memory via Pandas
    if col in df_received.columns:
        filtered_df = df_received[df_received[col] == val]
    return filtered_df

# ---------------------------------------------------------
# SCENARIO 2: NEW SYSTEM (Apache Arrow + Parquet + DuckDB)
# ---------------------------------------------------------
def new_system_full_transfer(df):
    # Node 1: Convert to Arrow and write to Parquet (Disk I/O)
    file_path = 'curio_node_transfer.parquet'
    table = pa.Table.from_pandas(df)
    pq.write_table(table, file_path)
    
    # Node 2: Receive file path, query entire file into memory via DuckDB
    con = duckdb.connect()
    df_received = con.execute(f"SELECT * FROM '{file_path}'").df()
    return file_path, df_received

def new_system_filtered(df, col, val):
    file_path = 'curio_node_transfer.parquet'
    table = pa.Table.from_pandas(df)
    pq.write_table(table, file_path)
    
    # Node 2: Push the filter down to the Parquet reader level
    con = duckdb.connect()
    # DuckDB extracts only the matching rows/columns from disk
    query = f"SELECT * FROM '{file_path}'"
    if col in df.columns:
        query += f" WHERE \"{col}\" = {val}"
    
    filtered_df = con.execute(query).df()
    return filtered_df

# =========================================================
# BENCHMARK EXECUTION
# =========================================================

# --- 1. Payload Size (Disk I/O vs Network/IPC string) ---
json_str, _ = old_system_full_transfer(df_real)
old_payload_size_mb = sys.getsizeof(json_str) / (1024 * 1024)

parquet_path, _ = new_system_full_transfer(df_real)
new_payload_size_mb = os.path.getsize(parquet_path) / (1024 * 1024)

print("--- PAYLOAD SIZE (I/O) ---")
print(f"Old System (JSON String size):  {old_payload_size_mb:.2f} MB")
print(f"New System (Parquet File size): {new_payload_size_mb:.2f} MB")
print(f"Reduction: {((old_payload_size_mb - new_payload_size_mb) / old_payload_size_mb) * 100:.1f}%\n")

# --- 2. Speed: Full Transfer ---
print("--- SPEED: FULL TRANSFER ---")
start_old = time.time()
old_system_full_transfer(df_real)
time_old = time.time() - start_old

start_new = time.time()
new_system_full_transfer(df_real)
time_new = time.time() - start_new

print(f"Old System Time: {time_old:.4f} sec")
print(f"New System Time: {time_new:.4f} sec\n")

# --- 3. Speed: Filtered Query (Downstream Node Operations) ---
print("--- SPEED: FILTERED TRANSFER ---")
start_old_f = time.time()
old_system_filtered(df_real, FILTER_COLUMN, FILTER_VALUE)
time_old_f = time.time() - start_old_f

start_new_f = time.time()
new_system_filtered(df_real, FILTER_COLUMN, FILTER_VALUE)
time_new_f = time.time() - start_new_f

print(f"Old System (Load all, then filter): {time_old_f:.4f} sec")
print(f"New System (DuckDB Predicate Pushdown): {time_new_f:.4f} sec\n")

# --- 4. Peak Memory Consumption ---
print("--- PEAK MEMORY CONSUMPTION ---")
# Using memory_profiler to track peak RAM usage during the function calls
mem_old = memory_usage((old_system_full_transfer, (df_real,)), max_usage=True)
mem_new = memory_usage((new_system_full_transfer, (df_real,)), max_usage=True)

print(f"Old System Peak Memory: {mem_old:.2f} MB")
print(f"New System Peak Memory: {mem_new:.2f} MB\n")

# Cleanup
if os.path.exists(parquet_path):
    os.remove(parquet_path)