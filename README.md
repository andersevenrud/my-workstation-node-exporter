# my-workstation-node-exporter

A prometheus statistics exporter that collects statistics from various sources:

* lmsensors
* mpstat
* hwmon
* nvidia-smi
* nvidia-settings
* cpufreq
* powercap
* free

**This was made for personal purposes, but you might find something of use in here**

## Usage

```shell
# Install dependencies
npm install

# start server
node index.js

# ... or the developer server with reload on change:
npm run serve
```

You can now get metrics from `http://<ip>:<port>/metrics`.

Create a systemd user unit to make this run in the background. The `nvidia-settings` module requires an X11 session.

### Configuration

`EXPRESS_PORT` environmental variable sets the HTTP port.

Modules can be disabled by manually editing `modules.js`.

## License

CC BY
