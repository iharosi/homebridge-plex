'use strict';

// eslint-disable-next-line no-unused-vars
const request = require('request');
const requestPromise = require('request-promise-native');
let Service;
let Characteristic;

class Plex {
  constructor(log, config) {
    if (this.debug) {
      this.log('Getting initialized...');
    }
    this.log = log;
    this.name = config.name;
    this.plexToken = config.plex_token;
    this.host = config.host || 'localhost';
    this.port = config.port || '32400';
    this.secure = config.secure || false;
    this.filter = config.filter || [];
    this.pollingInterval = config.polling_interval * 1000 || 3000;
    this.debug = config.debug || false;
    this.service = new Service.OccupancySensor(this.name);
    this.playing = false;

    this.service
      .getCharacteristic(Characteristic.OccupancyDetected)
      .on('get', this.getState.bind(this));

    const callback = (err, value) => {
      setTimeout(() => {
        this.getState(callback);
      }, this.pollingInterval);

      if (err !== null) {
        return;
      }

      this.service
        .getCharacteristic(Characteristic.OccupancyDetected)
        .updateValue(value);
    };

    this.getState(callback);
  }

  getState(callback) {
    const options = {
      url: `http${this.secure ? 's' : ''}://${this.host}:${this.port}/status/sessions`,
      rejectUnauthorized: false, // Plex certificates are not signed for a nice hostname / IP
      headers: {
        'Accept': 'application/json',
        'X-Plex-Token': this.plexToken
      }
    };

    if (this.debug) {
      this.log('Getting current state...');
    }

    requestPromise(options)
      .then(response => {
        const data = JSON.parse(response).MediaContainer;
        let playing = false;

        if (data.size === 0) {
          if (this.debug) {
            this.log('No active sessions on your server. Plex is not playing.');
          }

          callback(null, false);
          return;
        }

        if (this.debug && data.size === 1) {
          this.log('There is one active session:');
        } else if (this.debug && data.size > 1) {
          this.log('There are %s active sessions:', data.size);
        }

        data.Metadata.forEach(e => {
          const player = e.Player.title;
          const user = e.User.title;
          const state = e.Player.state;
          const stateMatch = state === 'playing';
          let rulesMatch = true;

          if (stateMatch && player) {
            rulesMatch = false;
            this.filter.forEach(rule => {
              if (this.debug) {
                this.log(`'${rule.player}' vs '${player}'`);
                this.log(`'${rule.user}' vs '${user}'`);
              }
              let playerMatch = !rule.player || rule.player.indexOf(player) > -1;
              let userMatch = !rule.user || rule.user.indexOf(user) > -1;
              rulesMatch = rulesMatch || playerMatch && userMatch;
            });
          }

          if (this.debug) {
            this.log('→ %s [%s]: %s%s', user, player, state, rulesMatch ? '' : ' (ignored)');
          }

          playing = playing || stateMatch && rulesMatch;

          if (this.debug || this.playing !== playing) {
            this.log('Plex is %splaying.', playing ? '' : 'not ');
          }
        });

        this.playing = playing;
        callback(null, playing);
      })
      .catch(error => {
        this.log(error && error.message);
        callback(error);
      });
  }

  getServices() {
    return [this.service];
  }
}

module.exports = homebridge => {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;

  homebridge.registerAccessory('homebridge-plex', 'Plex', Plex);
};
