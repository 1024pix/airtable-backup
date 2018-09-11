const Promise = require('prfun')
const _ = require('lodash')
const axios = require('axios')
require('@3846masa/axios-cookiejar-support')(axios)
const tough = require('tough-cookie')
const Airtable = require('airtable')
const fs = require('fs')
const path = require('path')
const async = require('async')

async function bases (email, password, apiInfo = true) {
  const baseUrl = 'https://airtable.com'

  // cookies are required for the authentication to work
  const requestWithCookies = axios.create({
    jar: new tough.CookieJar(),
    withCredentials: true
  })

  const loginForm = await requestWithCookies.get(`${baseUrl}/login`)
  const _csrf = loginForm.data.match(/name="_csrf"\s*value="(\S*)"/)[1]

  const app = await requestWithCookies.post(`${baseUrl}/auth/login`, {_csrf, email, password})
  const initData = JSON.parse(app.data.match(/initData.+?({.*})/)[1])

  let bases = _.mapValues(initData['rawApplications'], (app) => {
    return {
      name: app['name'],
      tables: _.fromPairs(_.map(app['visibleTableOrder'], (tableId) => {
        return [tableId, initData.rawTables[tableId].name]
      }))
    }
  })

  if (apiInfo) {
    bases = await Promise.props(_.mapValues(bases, async (base, baseId) => {
      const apiDocs = await requestWithCookies.get(`${baseUrl}/${baseId}/api/docs#curl/introduction`)
      const apiKey = apiDocs.data.match(/data-api-key="(\S*)"/)[1]
      const apiData = JSON.parse(apiDocs.data.match(/window\.application.+?({.*})/)[1])

      return _.merge(base, {
        apiDocs: apiDocs.data,
        apiKey: apiKey,
        apiData: apiData
      })
    }))
  }

  return bases
}

function tableRecords (apiKey, baseId, tableId, done) {
  const table = new Airtable({apiKey: apiKey}).base(baseId)(tableId)
  table.select().all((error, allRecords) => {
    if (error) {
      done(error, null)
    } else {
      done(null, _.map(allRecords, (record) => record._rawJson))
    }
  })
}

function attachmentsFromRecords (records) {
  const attachments = _.map(records, (record) => {
    return _.map(record.fields, (field) => {
      if (_.isArray(field) && field[0] && field[0].filename && field[0].url) {
        return _.map(field, (att) => {
          return {
            id: att.id,
            filename: att.filename,
            url: att.url
          }
        })
      } else {
        return []
      }
    })
  })

  return _.compact(_.flattenDeep(attachments))
}

function createDir (path) {
  if (fs.existsSync(path) === false) {
    fs.mkdirSync(path)
  }

  return path
}

function backupAttachments (attachmentsPath, attachments, allDone) {
  async.eachLimit(attachments, 10, (attachment, done) => {
    axios.get(attachment.url, {responseType: 'arraybuffer'}).then((download) => {
      const filePath = `${attachmentsPath}/${attachment.id}${path.extname(attachment.filename)}`
      fs.writeFileSync(filePath, download.data)
      done()
    })
  }, allDone)
}

function backupTable (backupDir, baseId, base, tableId, attachments) {
  tableRecords(base.apiKey, baseId, tableId, (error, records) => {
    const tableName = base.tables[tableId]
    if (error) {
      console.log(`${base.name} ${tableName} ERROR: ${error} ×`)
    } else {
      fs.writeFileSync(`${backupDir}/${tableId}.json`, JSON.stringify(records, undefined, 2))
      console.log(`${base.name} ${tableName} records ✔`)

      if (attachments) {
        const dir = createDir(`${backupDir}/attachments`)
        const attachments = attachmentsFromRecords(records)
        backupAttachments(dir, attachments, (error) => {
          if (error) {
            console.log(`${base.name} ${tableName} attachments ERROR: ${error} ×`)
          } else {
            console.log(`${base.name} ${tableName} attachments ✔`)
          }
        })
      }
    }
  })
}

function backupBase (baseId, base, attachments = true) {
  createDir('backups')
  createDir(`backups/${baseId}`)

  const dateTime = new Date()
  const backupDir = createDir(`backups/${baseId}/${dateTime.toISOString()}`)

  fs.writeFileSync(`${backupDir}/apiDocs.html`, base.apiDocs)
  fs.writeFileSync(`${backupDir}/apiData.json`, JSON.stringify(base.apiData, undefined, 2))

  _.forEach(base.tables, (tableName, tableId) => {
    backupTable(backupDir, baseId, base, tableId, attachments)
  })
}

function backupBases (email, password, baseFilter) {
  bases(email, password).then((bases) => {
    _.forEach(bases, (base, baseId) => {
      if (!baseFilter || baseId === baseFilter || base.name === baseFilter) {
        backupBase(baseId, base, process.env.AIRTABLE_BACKUP_ATTACHMENTS === 'true')
      }
    })
  }).catch((error) => {
    console.log(error)
  })
}

module.exports = backupBases
