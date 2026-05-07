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

# Frontend Changes

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
                // Change Content-Type (which is for sending data) 
                // to Accept (which tells the server what we want to receive)
                'Accept': 'application/vnd.apache.arrow.stream, application/json',
                // Add authorization token so the backend accepts the request
                ...(_token ? { 'Authorization': `Bearer ${_token}` } : {}),
            },
```

## ```ConnectionValidator.ts```
When I ran Curio and loaded a dataflow, it would crash and throw a runtime error that was something like: "TypeError: undefined is not an object (evaluating 'ConnectionValidator._inputTypesSupported[inNodeType].filter')". 

Due to this error, I added a safety check in ```checkBoxCompatibility``` to ensure we don't call .filter() on a bad input or output type:
```
if (!inputTypes || !outputTypes) return false;
```

# Concluding Notes
