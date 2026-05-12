# SQL Dashboard

A web-based SQL dashboard that can connect to MySQL/MariaDB, PostgreSQL, and SQLite servers.

## Features

- Add multiple database connections
- Supports MySQL/MariaDB, PostgreSQL, and SQLite
- Run SQL/command queries from the browser
- View server status and version information
- List tables per connection
- Delete saved connections

## Run locally

1. Install dependencies:

   ```bash
   npm install
   ```

2. Start the app:

   ```bash
   npm start
   ```

3. Open the browser:

   ```bash
   http://localhost:3000
   ```

## How to use

- Choose the server type and enter connection details.
- Save the connection and select it from the list.
- Use the command editor to run SQL or server commands.
- Refresh the server status to view version and host information.

## Notes

- This app is a dashboard for managing remote SQL servers via HTTP.
- It does not expose the raw database protocol directly to clients.
- Store credentials carefully; for production, add encryption and authentication.
