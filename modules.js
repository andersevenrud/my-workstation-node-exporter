/**
 * my-workstation-node-exporter
 * @author Anders Evenrud <andersevenrud@gmail.com>
 * @license CC BY
 */

const { promisify } = require('util')
const { exec } = require('child_process')
const fs = require('fs').promises
const glob = require('fast-glob')
const xml2js = require('xml2js')

/**
 * Execute command, but as a promise
 */
const execPromise = c => new Promise((y, n) => exec(c, (e, r) => e ? n(e) : y(r)))

/**
 * lmsensors executable
 */
const lmSensorsModule = () => {
  const sensorTypes = [
    [/^temp\d+_input/, 'temperature'],
    [/^fan\d+_input/, 'fan'],
    [/^in\d+_input/, 'voltage'],
    [/^in\d+_min/, 'voltageMin'],
    [/^in\d+_max/, 'voltageMax'],
    [/.*/, null]
  ]

  return {
    enabled: true,
    collect: () => execPromise('sensors -j').then(JSON.parse),
    parse: lm => Object.entries(lm).flatMap(([adapter, device]) => Object.keys(device)
      .filter(k => typeof device[k] === 'object')
      .flatMap(k => Object.entries(device[k])
        .map(([sensor, value]) => [sensor, value, sensorTypes.find(([re]) => re.exec(sensor))[1]])
        .map(([sensor, value, type]) => ({ type, value, sensor, adapter, label: k }))))
  }
}

/**
 * nvidia-smi executable
 */
const nvidiaSmiModule = () => {
  const parseValue = str => parseInt(str.split(' ')[0])

  return {
    enabled: true,
    collect: () => execPromise('nvidia-smi -x -q').then(promisify(xml2js.parseString)),
    parse: smi => (smi?.nvidia_smi_log?.gpu || []).flatMap((gpu, index) => {
      const [fan_speed] = gpu.fan_speed
      const [{ gpu_temp }] = gpu.temperature
      const [{ total: [total_mem], used: [used_mem], free: [free_mem] }] = gpu.fb_memory_usage
      const [{ gpu_util: [gpu_util], memory_util: [memory_util], encoder_util: [encoder_util], decoder_util: [decoder_util] }] = gpu.utilization
      const [{ power_draw: [power_draw] }] = gpu.power_readings
      const [{ graphics_clock: [graphics_clock], sm_clock: [sm_clock], mem_clock: [mem_clock], video_clock: [video_clock]}] = gpu.clocks

      return [
        {
          type: 'temperature',
          value: parseValue(gpu_temp[0]),
          sensor: 'temperature'
        },
        {
          type: 'memoryTotal',
          value: parseValue(total_mem),
          sensor: 'memory_total'
        },
        {
          type: 'memoryUsage',
          value: parseValue(used_mem),
          sensor: 'memory_used'
        },
        {
          type: 'memoryFree',
          value: parseValue(free_mem),
          sensor: 'memory_free'
        },
        {
          type: 'utilization',
          value: parseValue(gpu_util),
          sensor: 'utilization'
        },
        {
          type: 'utilization',
          value: parseValue(memory_util),
          sensor: 'memory_utilization',
          label: `NV ${index} Memory`,
        },
        {
          type: 'utilization',
          value: parseValue(encoder_util),
          sensor: 'encoder_utilization',
          label: `NV ${index} Encoder`,
        },
        {
          type: 'utilization',
          value: parseValue(decoder_util),
          sensor: 'decoder_utilization',
          label: `NV ${index} Decoder`,
        },
        {
          type: 'power',
          value: parseValue(power_draw),
          sensor: 'power_readings'
        },
        {
          type: 'fanspeed',
          value: parseValue(fan_speed),
          sensor: 'fan_speed'
        },
        {
          type: 'frequency',
          value: parseValue(graphics_clock) * 1000 * 1000,
          sensor: 'graphics_clock',
          label: `NV ${index} Core`,
        },
        {
          type: 'frequency',
          value: parseValue(sm_clock) * 1000 * 1000,
          sensor: 'sm_clock',
          label: `NV ${index} SM`,
        },
        {
          type: 'frequency',
          value: parseValue(mem_clock) * 1000 * 1000,
          sensor: 'mem_clock',
          label: `NV ${index} Mem`,
        },
        {
          type: 'frequency',
          value: parseValue(video_clock) * 1000 * 1000,
          sensor: 'video_clock',
          label: `NV ${index} Video`,
        },
      ].map(entry => ({
          label: `NV ${index}`,
          ...entry,
          device: `gpu${index}`,
          adapter: 'nvidia-smi',
          sensor: `gpu${index}_${entry.sensor}`,
      }))
    })
  }
}

/**
 * cpufreq kernel module
 */
const cpuFreqModule = () => ({
  enabled: true,
  collect: () => execPromise('cat /sys/devices/system/cpu/cpu*/cpufreq/scaling_cur_freq'),
  parse: str => str
    .trim()
    .split('\n')
    .map(s => parseInt(s))
    .map((n, i) => ({
      type: 'frequency',
      adapter: 'cpu',
      sensor: `cpu${i}_clock`,
      label: `Core ${i}`,
      value: n * 1000
    }))
})

/**
 * memory from system utils
 */
const memoryModule = () => {
  const labels = {
    mem: 'Memory',
    swap: 'Swap'
  }

  return {
    enabled: true,
    collect: () => execPromise('free -m'),
    parse: str => str
      .split('\n')
      .slice(1)
      .map(s => s.replace(/\s+/g, ' ').replace(':', '').trim())
      .filter(String)
      .flatMap(str => {
        const [key, total, used, free] = str.split(' ')
        const name = key.toLowerCase()
        const label = labels[name] || name

        return [
          {
            label,
            type: 'memoryTotal',
            value: parseInt(total),
            sensor: `${name}_total`,
            adapter: 'free'
          },
          {
            label,
            type: 'memoryFree',
            value: parseInt(free),
            sensor: `${name}_free`,
            adapter: 'free'
          },
          {
            label,
            type: 'memoryUsage',
            value: parseInt(used),
            sensor: `${name}_used`,
            adapter: 'free'
          },
        ]
      })
  }
}

/**
 * mpstat cpu information
 */
const mpStatModule = () => ({
  enabled: true,
  collect: () => execPromise('mpstat 1 1 -o JSON').then(JSON.parse),
  parse: (mp) => {
    const [host] = mp.sysstat.hosts
    const [stats] = host.statistics
    const { 'cpu-load': [cpu] } = stats

    return [
      {
        type: 'utilization',
        value: Math.round(100 - cpu.idle),
        sensor: 'cpu0_utilization',
        label: 'CPU 0',
        adapter: 'mpstat'
      }
    ]
  }
})

/**
 * nvidia-smi information
 */
const nvidiaSettingsModule = () => ({
  enabled: true,
  collect: () => execPromise('nvidia-settings -q all'),
  parse: nv => nv
    .trim()
    .split('\n')
    .filter(str => str.match(`Attribute 'GPUCurrentFanSpeedRPM'`))
    .map(str => str.match(/(\d+)\[fan:(\d+)\]\): (\d+)/))
    .map(([, gpuid, fanid, value]) => ({
      type: 'fan',
      adapter: 'nvidia-settings',
      sensor: `gpu${gpuid}_fan${fanid}_input`,
      device: `gpu${gpuid}`,
      label: `NV ${gpuid} #${fanid}`,
      value: parseInt(value)
    }))
})

/**
 * hwmon PWM information
 */
const hwmonModule = () => ({
  enabled: true,
  collect: async () => {
    const arr = await glob('/sys/devices/platform/*/hwmon/hwmon*/pwm*')
    const filtered = arr.filter(str => str.match(/\/pwm\d+$/))
    const files = filtered.map(f => fs.readFile(f, 'utf8'))
    const values = await Promise.all(files)
    return filtered.map((name, index) => ({ name, current: values[index] }))
  },
  parse: hw => hw
    .map(({ name, current }) => {
      const [adapter, _, device, sensor] = name.replace('/sys/devices/platform/', '').split('/')
      const value = Math.round((parseInt(current.trim()) / 255) * 100)
      return { type: 'fanspeed', label: sensor, sensor, adapter, device, value }
    })
})

/**
 * powercap kernel module
 */
const powercapModule = () => {
  // Get Watts used in last measurement based on diff of micro Joules counter.
  const calculate = (a, b) => Math.round((a - b) / 1000000)

  const read = () => execPromise('cat /sys/class/powercap/intel-rapl/intel-rapl:0/energy_uj')
    .then(str => parseInt(str.trim()))

  return {
    enabled: true,
    collect: async() => {
      const before = await read()
      await new Promise(r => setTimeout(r, 1000))
      const after = await read()
      return calculate(after, before)
    },
    parse: value => [
      {
        type: 'power',
        sensor: 'power_readings',
        device: 'cpu0',
        adapter: 'powercap',
        label: 'CPU 0',
        sensor: 'cpu0_power_readings',
        value
      }
    ]
  }
}

module.exports = [
  lmSensorsModule,
  nvidiaSmiModule,
  cpuFreqModule,
  memoryModule,
  mpStatModule,
  nvidiaSettingsModule,
  hwmonModule,
  //powercapModule
]
