#!/usr/bin/env node

const email = process.argv[2]
const password = process.argv[3]
const database = process.argv[4]

if (!email || !password) {
  console.error('Usage: airtable-backup email password [database]')
  process.exit(1)
}

require('./lib.js')(email, password, database)
