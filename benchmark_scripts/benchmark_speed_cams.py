import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
import duckdb
import time
import os
import sys
import io
from memory_profiler import memory_usage

# ---------------------------------------------------------
# SCENARIO 1: OLD SYSTEM (JSON String Transfer)
# ---------------------------------------------------------
def old_system_full_transfer(df):
    json_payload = df.to_json(orient='records')
    # Wrap in StringIO to fix Pandas warning
    df_received = pd.read_json(io.StringIO(json_payload), orient='records')
    return json_payload, df_received

def old_system_filtered(df, col, val):
    json_payload = df.to_json(orient='records')
    df_received = pd.read_json(io.StringIO(json_payload), orient='records')
    if col in df_received.columns:
        filtered_df = df_received[df_received[col] == val]
    return filtered_df

# ---------------------------------------------------------
# SCENARIO 2: NEW SYSTEM (Apache Arrow + Parquet + DuckDB)
# ---------------------------------------------------------
def new_system_full_transfer(df):
    file_path = 'curio_node_transfer.parquet'
    table = pa.Table.from_pandas(df)
    pq.write_table(table, file_path)
    
    con = duckdb.connect()
    df_received = con.execute(f"SELECT * FROM '{file_path}'").df()
    return file_path, df_received

def new_system_filtered(df, col, val):
    file_path = 'curio_node_transfer.parquet'
    table = pa.Table.from_pandas(df)
    pq.write_table(table, file_path)
    
    con = duckdb.connect()
    # Using parameterized queries to safely handle different types
    query = f"SELECT * FROM '{file_path}' WHERE \"{col}\" = ?"
    filtered_df = con.execute(query, [val]).df()
    return filtered_df

# =========================================================
# BENCHMARK EXECUTION (Guarded to prevent multiprocessing bugs)
# =========================================================
if __name__ == '__main__':
    # Switch to one of the larger ZIPPED datasets
    DATA_PATH = "docs/examples/data/Speed_Camera_Violations.zip" 
    
    if not os.path.exists(DATA_PATH):
        print(f"Cannot find {DATA_PATH}. Falling back to generating dummy data.")
        # Fallback to a large dummy dataset if ZIP isn't found
        FILTER_COLUMN = 'Category'
        FILTER_VALUE = 'A'
        df_real = pd.DataFrame({
            FILTER_COLUMN: ['A' if i % 2 == 0 else 'B' for i in range(100_000)],
            'Value': range(100_000)
        })
    else:
        print(f"Loading Speed Camaera Violations dataset from ZIP: {DATA_PATH}")
        # Pandas handles zip extraction natively if it contains a single CSV
        df_real = pd.read_csv(DATA_PATH, compression='zip')
        
        # Dynamically select a filter column and value to ensure it works 
        # regardless of whether you load Speed Cameras or Red Light Violations
        FILTER_COLUMN = df_real.columns[0]
        # .item() safely converts numpy scalar types to native python types for DuckDB
        FILTER_VALUE = df_real[FILTER_COLUMN].dropna().iloc[0]
        if hasattr(FILTER_VALUE, 'item'):
            FILTER_VALUE = FILTER_VALUE.item() 
            
        print(f"Dynamically testing filter pushdown using: {FILTER_COLUMN} = {FILTER_VALUE}")
        
    print(f"Dataset Shape: {df_real.shape}")
    print("-" * 50)

    # --- 1. Payload Size (Disk I/O vs Network/IPC string) ---
    json_str, _ = old_system_full_transfer(df_real)
    old_payload_size_mb = sys.getsizeof(json_str) / (1024 * 1024)

    parquet_path, _ = new_system_full_transfer(df_real)
    new_payload_size_mb = os.path.getsize(parquet_path) / (1024 * 1024)

    print("--- PAYLOAD SIZE (I/O) ---")
    print(f"Old System (JSON String): {old_payload_size_mb:.2f} MB")
    print(f"New System (Parquet File): {new_payload_size_mb:.2f} MB")
    if old_payload_size_mb > 0:
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

    # --- 3. Speed: Filtered Query ---
    print("--- SPEED: FILTERED TRANSFER ---")
    start_old_f = time.time()
    old_system_filtered(df_real, FILTER_COLUMN, FILTER_VALUE)
    time_old_f = time.time() - start_old_f

    start_new_f = time.time()
    new_system_filtered(df_real, FILTER_COLUMN, FILTER_VALUE)
    time_new_f = time.time() - start_new_f

    print(f"Old System (Load all, filter): {time_old_f:.4f} sec")
    print(f"New System (DuckDB Pushdown): {time_new_f:.4f} sec\n")

    # --- 4. Peak Memory Consumption ---
    print("--- PEAK MEMORY CONSUMPTION ---")
    mem_old = memory_usage((old_system_full_transfer, (df_real,)), max_usage=True)
    mem_new = memory_usage((new_system_full_transfer, (df_real,)), max_usage=True)

    print(f"Old System Peak Memory: {mem_old:.2f} MB")
    print(f"New System Peak Memory: {mem_new:.2f} MB\n")

    # Cleanup
    if os.path.exists('curio_node_transfer.parquet'):
        os.remove('curio_node_transfer.parquet')