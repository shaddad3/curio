# Introduction & Disclaimer
## Intro & Background
For my course project, I aimed to "modify the data transfer between nodes in Curio to leverage Apache Arrow for data storage and DuckDB as a query engine". 
After 14 weeks of the course I had acheived what I had in mind for this goal, and that initial effort and modification can be seen in the **main** branch 
of this forked repository. In week 14, a major modification to Curio was made that overlapped with my goal: DuckDB was implemented to handle file storage and
file management for Curio, replacing the temporary file storage strategy that involved storing files on disk in the folder **./.curio/data**. Using DuckDB as
for file storage as well was a goal I had for my version as well, but I wasn't able to get it working within the course timeline.

## Important Disclaimer
This branch is my attempt at merging my initial effort of leveraging Arrow + DuckDB with Stefan's contribution of using DuckDB in Curio for file storage. **At present, 
the version of Curio implemented here does not function completely.** It works for some things, it has bugs for some other things (and has one major bug that I'll talk more
about later). 

## What is the Rest of this Markdown?
In the rest of this markdown, I document the main changes I made to Curio was to try and add in streaming a Arrow byte-stream to the frontend instead of JSON. There are two pieces of
Curio I modified to do this: **Backend and Frontend**. Most of the changes are in the Frontend, with only one file in the Backend being modified. 

# Installation & Setup
## Installation
For concreteness, I want to mention that on my system, I for some reason could not run it using Docker. I don't know why (I think it was a system issue, as I do have an older MacBook).
To run Curio (regardless of it was my version of the official version), I setup a Conda environment, following the steps under "Installing manually (with curio.py)" in the USAGE.md file inside the docs/ folder). 

## Setup
There is only one thing that needs to be added to get this experimental implementation of Curio working. We need to install the ```apache-arrow``` library in the frontend so that
we can read the Arrow byte-stream being sent from the backend to the frontend. To do this, I do the following:
```
cd utk_curio/frontend/urban-workflows/
npm install apache-arrow
```

Other than this, I didn't need to install or add any packages and libraries manually; the ```requirements.txt``` installations handled the rest.

# Brief Overview of Changes
The main changes I made to Curio was to try and add in streaming a Arrow byte-stream to the frontend instead of JSON. There are two pieces of
Curio I modified to do this: **Backend and Frontend**. Most of the changes are in the Frontend, with only one file in the Backend being modified. 


# Backend Changes
## ```app/api/routes.py```
This is the only change we do in the backend, as we want to keep all the DuckDB for file storage in tact and just change what is sent to the frontend.
We modify the **/get and /get-preview** endpoints to construct an Arrow Table from the retrieved data and to then stream this Arrow table to the frontend 
instead of sending JSON. Below I pasted the code snippet from the /get endpoint, and it is nearly identical for the /get-preview endpoint as well.

```
        data = resp.json()
        # Construct the data into an Arrow Table 
        if vega:
            data = transform_to_vega(data)
            arrow_table = pa.Table.from_pylist(data)
        else:
            data_payload = data.get("data", {})
            # Ensure inner dictionaries are converted to lists for Arrow's from_pydict
            if data_payload and len(data_payload) > 0 and isinstance(list(data_payload.values())[0], dict):
                clean_data = {col: list(vals.values()) for col, vals in data_payload.items()}
                arrow_table = pa.Table.from_pydict(clean_data)
            else:
                arrow_table = pa.Table.from_pydict(data_payload)
        print(f"[/get] id={file_name} took={time.perf_counter()-t0:.4f}s", flush=True)
        # arrow_table = pa.Table.from_pylist(data)
        # Stream the Arrow byte-stream to frontend instead of JSON!
        sink = pa.BufferOutputStream()

        with pa.ipc.new_stream(sink, arrow_table.schema) as writer:
            writer.write_table(arrow_table)
        
        return Response(
            sink.getvalue().to_pybytes(),
            mimetype='application/vnd.apache.arrow.stream'
        )
```

# Frontend Changes


## ```hook/useTableData.ts```

The first addition we made to this file was in the ```createTableData``` function. We add a safeguard to ensure that the Arrow data is not 
further parsed or modified and gets passed in the correct form.

Now this function looks like so:
```
const createTableData = (parsedOutput: any) => {
    let tableData: any[] = [];

    if (parsedOutput && parsedOutput !== "") {
        if (Array.isArray(parsedOutput)) {
            // Arrow data parsed directly into an array of rows
            tableData = parsedOutput;
        } else if (parsedOutput.dataType === "dataframe") {
            let columns = Object.keys(parsedOutput.data);
            let dfIndices = Object.keys(parsedOutput.data[columns[0]]);
            for (let i = 0; i < dfIndices.length; i++) {
                let element: any = {};
                for (const column of columns) {
                    element[column] = parsedOutput.data[column][dfIndices[i]];
                }
                tableData.push(element);
            }
        } else if (parsedOutput.dataType === "geodataframe" && parsedOutput.data.features.length > 0) {
            let columns = Object.keys(parsedOutput.data.features[0].properties);
            for (let i = 0; i < parsedOutput.data.features.length; i++) {
                let element: any = {};
                for (const column of columns) {
                    element[column] = parsedOutput.data.features[i].properties[column];
                }
                tableData.push(element);
            }
        }
    }

    return tableData;
  };
```

The second addition we made to this file was in the ```processDataAsync``` function. We add an interceptor within the map function to ensure
that the arrow byte-stream is being preserved for downstream nodes to use. 
```
        tabd = tabd.map ((item) => {
        // If it's an Arrow byte stream array, skip Object.assign to preserve the array structure 
        // needed downstream by Data Transformation nodes.
        if (Array.isArray(item)) {
            item.forEach((row: any, i: number) => {
                row.interacted = "0";
                if (data.propagation && data.propagation[i] !== undefined) {
                    row.interacted = data.propagation[i];
                }
            });
            return item;
        }

        let parsedInput = Object.assign({}, item);
        if(parsedInput.dataType == "dataframe") {
        // ... the rest of the existing dataframe/geodataframe mappings in this function
```

## ```adapters/node/DataPoolLifecycle.tsx```
Surrounding the Data Pool node, we had to make changes so that it would no longer loop through deep JSON. We pivotted away from JSON and to Parquet in the
original version of my Curio project, and have pulled that over to this attempted integration with the new DuckDB file storage architecture. The Data Pool node is 
still not functioning in my latest testing. For some reason, it displays "No Data". When I bypass the Data Pool and pass the data straight from a Data Loading or Transformation
node, the subsequent nodes do get the data and can access it (whether it is a plot or another computation node). The issue could be that the modifications I made in the previous 
version (using Parquet for on-disk storage, DuckDB for querying and returning Arrow byte-streams, and frontend handling the Arrow byte-stream instead of JSON) are not fully
compatible with the new changes to data storage with DuckDB. I believe it isn't insurmountable, but I was not able to get it working within the week I spent trying to merge the
two implementations. 

The changes that are currently in this file are as below:

```
useEffect(() => {
    if (output.content != "") {
      // ... existing parsing logic ...

      // Pass the path forward if it's a DuckDB/Parquet reference
      if (!parsedInput || !parsedInput.path || typeof parsedInput.path !== 'string') {
          // If it doesn't have a path, it might be legacy JSON data 
          // continue to interaction logic if it has .data, otherwise return.
          if (!parsedInput.data) return; 
      } else {
          // It's a DuckDB reference. Pass it downstream and exit the interaction block
          const clonedOutput = JSON.parse(JSON.stringify(parsedInput));
          data.outputCallback(data.nodeId, clonedOutput);
          return;
      }
      // ... rest of interaction logic ...
```

```
 const tableData = useMemo(() => {
    // 'output' now holds the path, so we use 'tabData' (populated by processDataAsync) for rendering the UI.
    const displayTable = tabData[parseInt(activeTab)];
    if (displayTable) return createTableData(displayTable as ICodeDataContent);
    return [];
  }, [tabData, activeTab, createTableData]);
```

## ```adapters/node/components/DataPoolContent.tsx```
We updated how the Data Pool handles and maps Arrow data to ensure it renders right.

The code now within one of the ```useEffect```'s is as below:
```
          setIsLoadingPreview(true);
          try {
              const previewData = await fetchPreviewData(fileId);
              let nextPreviewTable: any[] = [];
              // update rendering to work with the Arrow data
              if (Array.isArray(previewData)) {
                  nextPreviewTable = previewData;
              } else if (previewData.dataType === "dataframe" && previewData.data) {
                  const columns = Object.keys(previewData.data);
                  const firstColumn = columns[0];
                  // ... rest of the mapping
```

## ```components/UniversalNode.tsx```
I added a "success" to the output so that when a node finishes and runs successfully it notifies and signals this. Before it only signaled when an
error occurred.

```
useEffect(() => {
    outputCodeRef.current = output?.code;
    // Add "success" to the condition so the pipeline knows the node finished
    if (output?.code === "error" || output?.code === "success") {
      signalNodeExecDone(data.nodeId);
    }
  }, [output?.code]);
```

## ```services/api.ts```
In this file, we needed to update the ```headers``` so that we would accept the Arrow byte-stream as well:
```
headers: {
                // Change Content-Type to Accept (which tells the server what we want to receive)
                'Accept': 'application/vnd.apache.arrow.stream, application/json',
                // Add authorization token so the backend accepts the request
                ...(_token ? { 'Authorization': `Bearer ${_token}` } : {}),
            },
```

## ```ConnectionValidator.ts```
When I ran Curio and loaded a dataflow, it would crash and throw a runtime error that was something like: "TypeError: undefined is not an object (evaluating 'ConnectionValidator._inputTypesSupported[inNodeType].filter')". 

Due to this error, I added a safety check in ```checkBoxCompatibility``` to ensure we don't call .filter() on a bad input or output type:
```
static checkBoxCompatibility(
        outNodeType: NodeType | undefined,
        inNodeType: NodeType | undefined
    ) {
        if (outNodeType == undefined || inNodeType == undefined) return false;

        const inputTypes = ConnectionValidator._inputTypesSupported[inNodeType];
        const outputTypes = ConnectionValidator._outputTypesSupported[outNodeType];

        // Ensure we don't try to call .filter on undefined if the nodeType is missing/unregistered
        if (!inputTypes || !outputTypes) return false;

        let intersection = inputTypes.filter((value: any) => {
            return outputTypes.includes(value);
        });

        return intersection.length > 0;
    }
```

## ```PythonInterpreter.ts```
Various bugs surrounding the transfer of data from a node to another, and one of them was that after a Data Cleaning / Transformation node ran, we would get NoneType errors when running some simple data cleanup or modification (such as using fillna() to replace entries in a dataset). 
To fix this, inside of the ```interpretCode``` function, we update the final ```.then((json)``` block to parse the json input and output strings back into JavaScript objects. 

```
.then((json) => {
    let endTime = formatDate(new Date());

    // Parse stringified output and input
    if (typeof json.output === "string" && json.output !== "") {
        try { json.output = JSON.parse(json.output); } catch (e) {}
    }
    if (typeof json.input === "string" && json.input !== "") {
        try { json.input = JSON.parse(json.input); } catch (e) {}
    }

    let typesInput: string[] = [];
    // Safely check dataType after parsing
    if (input != "" && json.input && json.input.dataType) {
        typesInput = Array.isArray(json.input.dataType) ? json.input.dataType : [json.input.dataType];
    }

    let typesOuput: string[] = [];
    if (json.output != "") {
        if (json.stderr != "") {
            typesOuput = ["error"];
        } else if (json.output && json.output.dataType) {
            typesOuput = Array.isArray(json.output.dataType) ? json.output.dataType : [json.output.dataType];
        }
    }

    nodeExecProv(
        startTime,
        endTime,
        workflow_name,
        nodeType + "-" + nodeId,
        mapTypes(typesInput),
        mapTypes(typesOuput),
        unresolvedUserCode
    );

    callback(json);
})
```

# Concluding Notes
