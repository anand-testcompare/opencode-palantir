# Palantir Foundry

> Palantir Foundry is an enterprise data operating system that enables organizations to integrate data from any source, build a semantic layer (the Ontology) that maps data to real-world concepts, create operational applications, and deploy AI-powered workflows. This document provides an overview for AI agents helping users build in Foundry. This document was last updated Friday 19 December 2025.

## Platform Architecture

Foundry organizes data into two primary layers: the _data layer_ and the _object layer_ (Ontology). Applications then consume data from these layers to power operational workflows.

### 1. Data Layer

Raw data is stored in **datasets**, which typically represent tabular data like you might find in a spreadsheet, but support data at any scale. Data enters Foundry through **connectors** that sync from source systems (databases, APIs, cloud storage, enterprise systems like SAP). **Transforms** process and clean data, producing output datasets. The platform maintains complete **data lineage**, tracking how every dataset was produced and what logic was applied.

### 2. Ontology Layer (Object Layer)

The Ontology is a semantic layer that maps datasets and models to real-world concepts. It transforms rows into **objects** (like `Customer`, `Order`, `Aircraft`), columns into **properties** (characteristics of objects), and relationships into **links** (connections between objects). The Ontology includes:

- **Object types:** Schema definitions for real-world entities or events
- **Link types:** Relationship definitions between object types
- **Action types:** Definitions for sets of changes users can make to objects, property values, and links
- **Functions:** Server-side business logic that operates on the Ontology
- **Interfaces:** Abstract types describing the shape and capabilities of object types, enabling consistent interaction with object types that share a common shape

### Applications

Applications consume data from both layers to power operational workflows. Users interact with objects through **Workshop** (low-code application builder), **Slate** (custom HTML/CSS/JS applications), analytics tools like **Quiver** and **Object Explorer**, or custom applications built with the **Ontology SDK (OSDK)**.

### Data Flow Summary

```
Source Systems → Connectors → Datasets → Transforms → Clean Datasets
                                                            ↓
                                               Ontology (Objects, Links)
                                                            ↓
                                               Applications (Workshop, OSDK, and others)
                                                            ↓
                                               User Decisions → Actions → Writeback to external system
```

## Core Terminology

### Data Layer Terms

**Dataset:** A wrapper around a collection of files stored in Foundry. Datasets can be structured (tabular with schemas), unstructured (images, videos, PDFs), or semi-structured (JSON, XML). Datasets support versioning through transactions and maintain full history.

**Transform:** Code that processes input datasets to produce output datasets. Transforms are written in Code Repositories using Python, SQL, or Java, or in Code Workspaces using Python or R. Python transforms can run on lightweight single-node engines (Pandas, Polars, DuckDB) or distributed Spark.

**Pipeline Builder:** A point-and-click application for building data pipelines without writing code. Supports batch and streaming workflows.

**Sync:** The process of bringing data from external source systems into Foundry. There are several types: batch syncs (to datasets), streaming syncs (to streams), change data capture (CDC) syncs (to streams with changelog metadata), and media syncs (to media sets). Syncs can be scheduled or triggered manually.

**Connector:** A pre-built integration for connecting to external data sources (databases, cloud storage, APIs, enterprise systems).

**Incremental pipeline / transform:** A pipeline or transform that processes only rows or files that have changed since the last build, rather than reprocessing the entire dataset. Reduces latency and compute costs for large-scale datasets.

**Branch:** A version control concept allowing parallel development of pipelines, datasets, the Ontology, and Workshop applications. Changes are deployed back to the Main branch when ready.

### Ontology Terms

**Object:** A single instance of an object type, representing a real-world entity or event (for example, a specific flight "JFK → SFO 2021-02-24").

**Object Type:** The schema definition of a real-world entity or event. Defines properties, their types, the primary key, and backing dataset(s).

**Object Set:** A collection of objects, typically the result of a filter or search. Object sets can be passed to functions, displayed in applications, or used in actions.

**Property:** The schema definition of a characteristic of a real-world entity or event (for example, `employee number`, `start date`, `role`). Properties have types (string, integer, date, array, and others) and can be required or optional.

**Primary Key:** The unique identifier for objects of a type. Maps to a column in the backing dataset.

**Link Type:** The schema definition for relationships between object types (for example, the link between employee and company). Specifies cardinality (one-to-one, one-to-many, many-to-many) and which properties serve as foreign keys.

**Action Type:** A definition of changes or edits to objects, property values, and links that a user can take at once, including parameters, rules, submission criteria, and side effects (notifications, webhooks).

**Action:** A user-initiated transaction that modifies objects, properties, or links. Actions are instances of action types.

**Interface:** An abstract type describing shared properties across multiple object types. Enables polymorphic workflows.

**Materialization:** A dataset that combines data from input datasources with user edits to capture the latest state of each object. Used for building downstream Foundry pipelines or enabling downloads of Ontology data.

### Function Terms

**Function:** Server-side code (TypeScript or Python) that can read Ontology data, perform computations, and make Ontology edits.

**Function-backed Action:** An action type whose logic is implemented by a function rather than declarative rules.

**Function-backed Column:** A derived column in a Workshop Object Table whose value is calculated on-the-fly by a function. When using runtime input, the function processes only the objects currently displayed in the table for faster performance.

**Ontology Edits:** Modifications to objects, properties, and links performed by functions (creating objects, updating properties, deleting objects, adding/removing links).

### Application Terms

**Workshop:** A low-code application builder for creating operational applications using drag-and-drop widgets. Workshop apps are built on the Ontology and use events for interactivity.

**Widget:** A UI component in Workshop (table, chart, map, form, button, and others). Widgets bind to Ontology data and can trigger events.

**Event:** A configurable behavior in Workshop that is triggered by user interactions (for example, button selection, row selection). Events can update variables, navigate to pages or tabs, open or close overlays, open other Foundry resources, refresh data, or control module appearance.

**Variable:** A typed value used to configure how data moves through a Workshop module. Variables store values of various types (object sets, strings, numbers, booleans, dates, timestamps, arrays, structs, geopoints, geoshapes, time series) and bind to widget inputs and outputs to enable interactivity.

**Slate:** An application framework that enables application developers to construct customizable applications using a drag-and-drop interface, CSS and JavaScript.

**OSDK (Ontology SDK):** Auto-generated SDKs (TypeScript, Python, Java, plus OpenAPI spec for other languages) for accessing Ontology data and executing actions from external applications.

**Custom Widget:** A React component built with OSDK that extends Workshop's widget library.

### AI Platform (AIP) Terms

**AIP:** Palantir's Artificial Intelligence Platform for building AI-powered workflows, agents, and functions on top of the Ontology.

**AIP Agent:** An interactive assistant built in AIP Agent Studio, equipped with enterprise-specific information and tools (including Ontology data, documents, and custom functions).

**AIP Logic:** A no-code development environment for building, testing, and releasing LLM-powered functions that can return outputs or make edits to the Ontology.

**AIP Assist:** An in-platform LLM assistant for navigating and understanding Foundry.

**Retrieval Context:** Documents, object data, or function outputs provided to an AIP agent to ground its responses.

## Data Integration

Data integration in Foundry provides an extensible framework for connecting to source systems, transforming data, and maintaining high-quality pipelines.

### Pipeline Builder

**Pipeline Builder** is Foundry's primary application for data integration. It provides:

- Point-and-click interface for building pipelines
- Dataset health checks
- Type-safe transformations with schema safety
- Built-in LLM assistance for generating complex transformations
- Support for media processing and geospatial data

Workflow: Inputs → Transform → Preview → Deliver → Outputs

Pipeline Builder can output to datasets, media sets, geotemporal series syncs, virtual tables, or Ontology components (object types, link types, and time series syncs) directly.

### Code Repositories

For complex transformation logic, **Code Repositories** provides a web-based IDE for writing production-ready transforms in Python, Java, SQL, or Mesa. Features include:

- Git-based version control with branching
- Pull requests and code review
- IntelliSense and error checking
- Integration with CI/CD workflows

### Transform Languages

**Python Transforms** (most full-featured):

- Use `@transform.using` decorator
- Work with PySpark DataFrames or Pandas/Polars/DuckDB
- Support incremental computation
- Can call external APIs via `transforms-external-systems`

**SQL Transforms:**

- Declarative SQL syntax

**Java Transforms:**

- Access to full Spark Java API

### Processing Modes

**Batch:** Fully recomputes all datasets in the pipeline on each run.

**Incremental:** Processes only new/changed data. More efficient for large, append-only datasets. Requires careful handling of schema changes.

**Streaming:** Near real-time processing using Flink. For use cases requiring low latency.

### Data Quality

**Data Expectations:** Assertions about data quality (for example, "column X should never be null", "values should be in range"). Expectations can block builds if violated.

**Health Checks:** Monitoring rules that alert on pipeline issues, data freshness, or quality problems.

## Ontology

The Ontology is the semantic layer that transforms raw data into real-world concepts, enabling applications and users to work with meaningful entities rather than abstract tables.

### Object Types

An object type defines:

- **Properties:** Attributes with types (string, integer, double, boolean, date, timestamp, array, struct, geoshape, and others)
- **Primary Key:** Unique identifier property
- **Title:** The property that acts as a display name for objects of this type
- **Backing Datasource(s):** The source of the data used as property values for objects of this type

Objects are automatically created and updated through the indexing process when backing datasources are updated. One row = one object.

### Link Types

Link types define relationships with:

- **Source and Target Object Types:** Which types are connected
- **Cardinality:** One-to-one, one-to-many, many-to-one, or many-to-many
- **Key:** The properties or columns used to create links (foreign key to primary key for one-to-one/many-to-one, or join table for many-to-many)
- **Object-backed Links:** Use a backing object type to add additional metadata/properties on the relationship (extends many-to-one links)

Links enable traversing relationships: from an Order, navigate to its Customer; from a Customer, navigate to all their Orders.

### Interfaces

Interfaces provide polymorphism:

- Define shared properties that multiple object types implement
- Enable workflows that operate on any implementing type
- Example: `Facility` interface implemented by `Airport`, `Manufacturing Plant`, `Maintenance Hangar`

### Action Types

Action types define sets of changes or edits users can make to objects, property values, and links:

- **Parameters:** Inputs the user provides (object selections, text fields, dropdowns)
- **Rules:** Logic that transforms parameters into ontology edits (create/modify/delete objects and links)
- **Side Effects:** Notifications and webhooks to integrate with existing organizational processes
- **Submission Criteria:** Conditions that determine whether an Action can be submitted, supporting business logic and permissions.

Actions can be **function-backed** for complex logic that cannot be expressed declaratively.

## Functions

Functions enable server-side business logic with first-class Ontology support. Functions can:

- Query and aggregate object data
- Traverse links between objects
- Create, update, and delete objects (Ontology edits)
- Call external APIs

### Languages

**TypeScript v2:** Runs in a Node.js runtime with OSDK support, configurable resources, and Ontology interfaces support.

**TypeScript v1:** Supports webhooks, functions on models, and bring-your-own-model features not available in v2.

**Python:** Ontology object and edits support with OSDK. The only language usable in Pipeline Builder.

### TypeScript v1 Example

```typescript
import { Function } from "@foundry/functions-api";
import { Objects } from "@foundry/ontology-api";

export class FlightFunctions {
  @Function()
  public currentFlightDestinations(airportCode: string): Set<string> {
    const flightsFromAirport = Objects.search()
      .flights()
      .filter((flight) => flight.departureAirportCode.exactMatch(airportCode))
      .all();

    const destinations = flightsFromAirport.map(
      (flight) => flight.arrivalAirportCode!,
    );

    return new Set(destinations);
  }
}
```

### Python Example

```python
from functions.api import function, String

@function
def my_function() -> String:
    return "Hello World!"
```

### Function-backed Columns

Derived properties computed on-the-fly in Workshop Object Tables:

```typescript
@Function()
public flightAlertCalculateUrgency(flightAlerts: ObjectSet<FlightAlert>): FunctionsMap<FlightAlert, string>{
    const map = new FunctionsMap<FlightAlert, string>();
    flightAlerts.all().forEach(flightAlert => {
        var hoursDelayed = flightAlert.timeOfDelayHours
        if (hoursDelayed! > 4) {
            map.set(flightAlert, "High")
        } else if (hoursDelayed! > 2) {
            map.set(flightAlert, "Medium")
        } else {
            map.set(flightAlert, "Low")
        }
    });
    return map;
}
```

### Function-backed Actions

Actions implemented with Ontology edit functions:

```typescript
@OntologyEditFunction()
public addPriorityToTitle(ticket: DemoTicket): void {
    let newTitle: string = "[" + ticket.ticketPriority + "]" + ticket.ticketTitle;
    ticket.ticketTitle = newTitle;
}
```

## Applications

### Workshop

Workshop is a flexible, object-oriented application building tool that enables builders to create interactive applications for operational users. Key concepts:

**Widgets:** UI components that display content and are the core building blocks of a module's user interface

- Object Table: Display and interact with object sets
- Object List: Cards for browsing objects
- Chart XY: Visualizations backed by Ontology aggregations
- Inline Action: Enables users to create, modify, or delete objects or links via action types, supporting both form and table interfaces
- Map: Geospatial object visualization
- Button Group: Trigger Actions, Workshop events, URLs, and exports via styled buttons
- Many more (60+ widgets across display, visualization, filtering, navigation, and embedding categories)

**Events:** Trigger specific behavior based on user actions

- Row selection → update variable
- Button selection → execute action
- Object selection → navigate to detail view

**Variables:** Configure how data moves through a Workshop module

- Store object sets, object set filters, primitives (strings, numbers, booleans, dates, timestamps), arrays, structs, geopoints, geoshapes, and time series
- Bind to widget inputs and outputs
- Enable interactivity between widgets

**Layouts:** Configure how the user interface of a module is organized (columns, rows, tabs, flow, toolbar, loop)

- Pages, overlays (drawers and modals), collapsible sections

**Common Patterns:**

- Inbox/Task Management: List of items to triage and process
- Common Operational Picture (COP): Big-screen dashboards with maps and charts
- Detail Views: Drill down from list to individual object
- Forms: Capture user input and execute actions

### Slate

Slate enables application developers to construct customizable applications using a drag-and-drop interface, CSS and JavaScript:

- Drag-and-drop widget positioning
- Custom styling and branding
- Direct JavaScript for complex interactions
- Access to Ontology and Functions via API calls
- Support for public-facing applications

Use Slate when you need a code-first approach with full HTML, CSS, and JavaScript customization, custom styling and branding, or public-facing applications.

### OSDK (Ontology SDK)

For fully custom applications, OSDK generates type-safe SDKs:

**TypeScript SDK:**

```typescript
import { createClient } from "@osdk/client";
import { Employee } from "@your-generated-sdk";

const client = createClient(foundryUrl, ontologyRid, auth);
const result = await client(Employee).fetchPage();
const employees = result.data;
```

**Slate Integration:**

```typescript
import { client } from "@slate/osdk";

const driverResponse = await client.ontology.objects.F1Driver.fetchPage({
  pageSize: 10,
});
const driverNames = driverResponse.data.map(
  (driver) => `${driver.forename} ${driver.surname}`,
);
```

OSDK supports:

- Object queries with filtering, sorting, pagination
- Link traversal
- Action execution
- Real-time subscriptions
- Custom Workshop widgets

### Analytics Applications

**Quiver:** Point-and-click analysis on Ontology objects and time series

- Best for: Ontology-mapped data, time series, embeddable dashboards
- Features: Link traversal, time series formula language

**Contour:** Point-and-click analysis on datasets (tables)

- Best for: Large datasets (100k+ rows), non-Ontology data
- Features: Visual transforms, joins, aggregations, dashboards

**Code Workbook** [Legacy]: Code-based analysis notebooks

- Languages: Python, R, SQL
- Features: Visualization, collaboration, template reuse
- Note: Legacy status, consider other tools (Code Workspaces for exploratory analysis, Code Repositories for production pipelines)

**Notepad:** Object-aware collaborative rich-text editor

- Embed charts and tables from other tools
- Template-based report generation
- Point-in-time data snapshots

**Fusion:** Spreadsheet application

- Writeback from spreadsheets to datasets
- Familiar spreadsheet experience

**Object Explorer:** Search and analysis tool for answering questions about anything in the Ontology

- Keyword and property-based search
- Bulk actions on object sets
- Export capabilities

## AIP Applications

### AIP Agent Studio

Build interactive assistants (AIP Agents) with:

- **Retrieval Context:** Ground responses in Ontology objects, documents, or function outputs
- **Tools:** Enable agents to query data, execute actions, call functions
- **Application Variables:** Configure agent state and map to Workshop variables
- **Deployment:** Use in AIP Threads, Workshop, OSDK applications, or via API

Agent Tiers:

1. **Ad-hoc:** Use AIP Threads for quick document analysis
2. **Task-specific:** Build reusable agents with specific context
3. **Agentic Application:** Integrate agents into Workshop or OSDK apps
4. **Automated:** Publish agent as function for autonomous workflows via AIP Automate

### AIP Logic

No-code environment for LLM-powered functions:

- Visual block-based interface
- Intuitive prompt engineering with natural language
- Query Ontology objects for context
- Make Ontology edits based on LLM output
- Integrate with Automate for triggered or scheduled execution of Ontology edits

Use cases:

- Extract structured data from unstructured text
- Classify and route incoming requests
- Generate summaries and recommendations

### AIP Assist

In-platform LLM assistant for:

- Navigating Foundry documentation
- Understanding platform capabilities
- Developer assistance with code and APIs

### AIP Evals

Testing environment to evaluate AIP Logic functions, Agent functions, and code-authored functions, specifically designed for handling LLM non-determinism:

- Create evaluation suites with test cases
- Measure quality metrics
- Run experiments with parameter combinations
- Compare model performance

## Automation

### Automate

Automate triggers actions based on conditions:

**Conditions:**

- Time-based: "Every Monday at 9am"
- Data-based: "When a high-priority alert is created"
- Combined: "Every Monday at 9am, check for new high-priority alerts"

**Effects:**

- Submit Actions to modify Ontology
- Send notifications (email, platform)
- Attach generated reports (from Notepad)

Use cases:

- Scheduled report sending and digests
- Data alerting
- Workflow automation
- Watched searches

## Developer Tools

### Code Repositories

Web-based IDE for:

- Python, Java, SQL transforms
- TypeScript and Python functions
- Git version control
- Pull requests and code review
- CI/CD integration

### Developer Console

Portal for:

- OSDK generation and management
- OAuth client configuration
- Application sharing and long-lived tokens

### REST APIs

Programmatic access to:

- Ontology queries and edits
- Dataset operations
- AIP agent interactions
- Platform administration

### VS Code Integration

- VS Code Workspaces in browser
- Local VS Code with Palantir extension
- Continue extension for AI assistance with Foundry context

### Palantir MCP

Model Context Protocol server enabling:

- External AI IDEs to access Foundry context
- Documentation and API discovery
- Application building assistance

## Security & Governance

Foundry security is built on:

### Access Control

- **Projects:** Primary security boundary for organizing work and resources
- **Organizations:** Mandatory controls for user silos
- **Roles:** Discretionary permissions (Owner, Editor, Viewer, Discoverer)
- **Markings:** Mandatory controls for sensitive data (PII, PHI, and others)

### Data Protection

- Encryption at rest and in transit
- Single sign-on and multi-factor authentication
- Comprehensive audit logging
- Row and column-level security

### Governance

- Data lineage tracking
- Sensitive data scanning
- Data retention policies
- Checkpoint justifications for sensitive actions

## Documentation Links

### Getting Started

- [Overview](https://www.palantir.com/docs/foundry/getting-started/overview)
- [Introductory Concepts](https://www.palantir.com/docs/foundry/getting-started/introductory-concepts)
- [Application Reference](https://www.palantir.com/docs/foundry/getting-started/application-reference)

### Data Integration

- [Data Integration Overview](https://www.palantir.com/docs/foundry/data-integration/overview)
- [Pipeline Builder](https://www.palantir.com/docs/foundry/pipeline-builder/overview)
- [Code Repositories](https://www.palantir.com/docs/foundry/code-repositories/overview)
- [Python Transforms](https://www.palantir.com/docs/foundry/transforms-python/overview)

### Ontology

- [Ontology Overview](https://www.palantir.com/docs/foundry/ontology/overview)
- [Object Types](https://www.palantir.com/docs/foundry/object-link-types/object-types-overview)
- [Link Types](https://www.palantir.com/docs/foundry/object-link-types/link-types-overview)
- [Action Types](https://www.palantir.com/docs/foundry/action-types/overview)
- [Interfaces](https://www.palantir.com/docs/foundry/interfaces/interface-overview)

### Functions

- [Functions Overview](https://www.palantir.com/docs/foundry/functions/overview)
- [TypeScript v1 Getting Started](https://www.palantir.com/docs/foundry/functions/typescript-v1-getting-started)
- [TypeScript v2 Getting Started](https://www.palantir.com/docs/foundry/functions/typescript-v2-getting-started)
- [Python Functions](https://www.palantir.com/docs/foundry/functions/python-getting-started)

### Applications

- [Workshop](https://www.palantir.com/docs/foundry/workshop/overview)
- [Slate](https://www.palantir.com/docs/foundry/slate/overview)
- [OSDK](https://www.palantir.com/docs/foundry/ontology-sdk/overview)
- [OSDK React Applications](https://www.palantir.com/docs/foundry/ontology-sdk-react-applications/overview)

### AI Platform

- [AIP Overview](https://www.palantir.com/docs/foundry/aip/overview)
- [Agent Studio](https://www.palantir.com/docs/foundry/agent-studio/overview)
- [AIP Logic](https://www.palantir.com/docs/foundry/logic/overview)
- [AIP Evals](https://www.palantir.com/docs/foundry/aip-evals/overview)

### Analytics

- [Quiver](https://www.palantir.com/docs/foundry/quiver/overview)
- [Contour](https://www.palantir.com/docs/foundry/contour/overview)
- [Notepad](https://www.palantir.com/docs/foundry/notepad/overview)

### Automation

- [Automate](https://www.palantir.com/docs/foundry/automate/overview)
- [Foundry Rules](https://www.palantir.com/docs/foundry/foundry-rules/overview)

### Security

- [Security Overview](https://www.palantir.com/docs/foundry/security/overview)
