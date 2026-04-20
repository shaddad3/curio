import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
import duckdb
import time
import os
import io

# ---------------------------------------------------------
# TRANSFER FUNCTIONS
# ---------------------------------------------------------
def time_old_system(df):
    start = time.time()
    # Old Curio approach: serialize to JSON string and back
    json_payload = df.to_json(orient='records')
    df_received = pd.read_json(io.StringIO(json_payload), orient='records')
    return time.time() - start

def time_new_system(df):
    start = time.time()
    # New Curio approach: write to Parquet and query with DuckDB
    file_path = 'curio_node_transfer.parquet'
    table = pa.Table.from_pandas(df)
    pq.write_table(table, file_path)
    
    con = duckdb.connect()
    df_received = con.execute(f"SELECT * FROM '{file_path}'").df()
    return time.time() - start

# ---------------------------------------------------------
# CROSSOVER FINDER (LONG DATA)
# ---------------------------------------------------------
if __name__ == '__main__':
    # Use the long, narrow zipped dataset
    DATA_PATH = "docs/examples/data/red-light-violation.zip" 
    
    if not os.path.exists(DATA_PATH):
        print(f"Error: Run this from the repo root so it can find {DATA_PATH}")
        exit()

    print(f"Loading Long Dataset from ZIP: {DATA_PATH}")
    # Pandas can natively extract the CSV from a zip archive
    df_full = pd.read_csv(DATA_PATH, compression='zip')
    print(f"Loaded Full Dataset: {df_full.shape[0]} rows, {df_full.shape[1]} columns\n")
    
    # Test sizes scale much higher for long data to find the crossover
    test_sizes = [1000, 2000, 3000, 4000, 5000, 10000, 25000, 50000, 75000, 100000, 150000, 200000, 300000]
    
    # Ensure we don't try to sample more rows than exist in the dataset
    test_sizes = [size for size in test_sizes if size <= df_full.shape[0]]
    if df_full.shape[0] not in test_sizes:
        test_sizes.append(df_full.shape[0])
        
    crossover_found = False

    print(f"{'Row Count':<12} | {'Old System (JSON)':<20} | {'New System (DuckDB)':<20} | {'Winner'}")
    print("-" * 75)

    for size in test_sizes:
        # Take a realistic subset of the long data
        df_subset = df_full.head(size)
        
        # Warmup (ignoring first runs to account for OS caching/JIT compilation)
        time_old_system(df_subset)
        time_new_system(df_subset)
        
        # Actual Timed Runs
        time_old = time_old_system(df_subset)
        time_new = time_new_system(df_subset)
        
        winner = "Old (JSON)" if time_old < time_new else "New (DuckDB)"
        
        print(f"{size:<12} | {time_old:<20.4f} | {time_new:<20.4f} | {winner}")
        
        # Note the exact moment the scaling curves cross
        if winner == "New (DuckDB)" and not crossover_found:
            crossover_point = size
            crossover_found = True

    print("-" * 75)
    if crossover_found:
        print(f"\n=> TIPPING POINT REACHED: The new DuckDB/Parquet architecture")
        print(f"   becomes faster at approximately {crossover_point} rows (for a {df_full.shape[1]}-column dataset).")
    else:
        print("\n=> No crossover found in this range. The dataset might still be too small, or JSON is surprisingly fast.")

    # Cleanup
    if os.path.exists('curio_node_transfer.parquet'):
        os.remove('curio_node_transfer.parquet')