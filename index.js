/**
 * my-workstation-node-exporter
 * @author Anders Evenrud <andersevenrud@gmail.com>
 * @license CC BY
 */

const client = require('prom-client')
const express = require('express')
const allModules = require('./modules')

const PORT = process.env.EXPRESS_PORT || 9011

/**
 * Returns a function that collects all statistics
 * in parallel
 */
const createCollector = (modules, gauges) => async () => {
  const collection = await Promise.all(
    modules.map(async m => m.parse(await m.collect()))
  )

  collection
    .flat()
    .filter(i => gauges[i.type])
    .map(i => [i, gauges[i.type]])
    .forEach(([{ type, value, ...attributes }, gauge]) => gauge.set(attributes, value))

  return client.register.metrics()
}

/**
 * Creates a set or pre-defined gauges used in the node exporter.
 * Any data entry that does not match a key in this record is
 * ignored.
 */
const createGauges = () => {
  const labelNames = ['device', 'adapter', 'sensor', 'label']

  return {
    temperature: new client.Gauge({ name: 'sensors_temperature', help: 'Temperature in celcius', labelNames }),
    voltage: new client.Gauge({ name: 'sensors_voltage', help: 'Voltage', labelNames }),
    voltageMin: new client.Gauge({ name: 'sensors_voltage_min', help: 'Voltage Max', labelNames }),
    voltageMax: new client.Gauge({ name: 'sensors_voltage_max', help: 'Voltage Min', labelNames }),
    power: new client.Gauge({ name: 'sensors_power', help: 'Power usage in Watts', labelNames }),
    memoryUsage: new client.Gauge({ name: 'sensors_memory_usage', help: 'Memory usage in M', labelNames }),
    memoryTotal: new client.Gauge({ name: 'sensors_memory_total', help: 'Memory total in M', labelNames }),
    memoryFree: new client.Gauge({ name: 'sensors_memory_free', help: 'Memory free in M', labelNames }),
    utilization: new client.Gauge({ name: 'sensors_utilization', help: 'Utilization in percentage', labelNames }),
    fan: new client.Gauge({ name: 'sensors_fans', help: 'Fan speed in RPM', labelNames }),
    fanspeed: new client.Gauge({ name: 'sensors_fanspeed', help: 'Fan speed in percentage', labelNames }),
    frequency: new client.Gauge({ name: 'sensors_frequenzy', help: 'Frequenzy in MHz', labelNames }),
  }
}

/**
 * Creates the HTTP server user for metrics collection
 */
const createServer = (collect) => {
  const server = express()

  server.get('/metrics', (req, res, next) => collect().then(str => res.end(str)).catch(next))
  server.use((e, req, res, next) => res.status(500).json({ error: e.message, stack: e.stack }))

  return server
}

/**
 */
const main = () => {
  const modules = allModules.map(m => m()).filter(m => m.enabled)
  const gauges = createGauges()
  const collect = createCollector(modules, gauges)
  const server = createServer(collect)

  server.listen(PORT, () => console.info('Listening on', PORT))
}

main()
