import type {PlatformAccessory} from 'homebridge';
import {debounce, find} from 'lodash';
import TydomController from '../controller';
import {TydomAccessoryContext, TydomEndpointData} from '../typings/tydom';
import {
  addAccessoryService,
  getAccessoryService,
  setupAccessoryIdentifyHandler,
  setupAccessoryInformationService
} from '../utils/accessory';
import {chalkString} from '../utils/chalk';
import {debug, debugGet, debugGetResult, debugSet, debugSetResult, debugSetUpdate, debugTydomPut} from '../utils/debug';
import {
  Characteristic,
  CharacteristicEventTypes,
  CharacteristicSetCallback,
  CharacteristicValue,
  NodeCallback,
  Service
} from '../utils/hap';
import {getTydomDataPropValue, getTydomDeviceData} from '../utils/tydom';
import {addAccessorySwitchableService, updateAccessorySwitchableService} from './services/switchableService';

export const setupLightbulb = (accessory: PlatformAccessory, controller: TydomController): void => {
  const {context} = accessory;
  const {client} = controller;
  const {On, Brightness} = Characteristic;

  const {deviceId, endpointId, metadata} = context as TydomAccessoryContext;
  setupAccessoryInformationService(accessory, controller);
  setupAccessoryIdentifyHandler(accessory, controller);

  const levelMeta = find(metadata, {name: 'level'});

  // Not dimmable
  if (levelMeta?.step === 100) {
    addAccessorySwitchableService(accessory, controller, Service.Lightbulb);
    return;
  }

  // Dimmable
  const service = addAccessoryService(accessory, Service.Lightbulb, `${accessory.displayName}`, true);
  // State
  const state = {
    latestBrightness: 100
  };

  const debouncedSetLevel = debounce(
    async (value: number) => {
      debugTydomPut('level', accessory, value);
      await client.put(`/devices/${deviceId}/endpoints/${endpointId}/data`, [
        {
          name: 'level',
          value
        }
      ]);
    },
    15,
    {leading: true, trailing: false}
  );

  service
    .getCharacteristic(Characteristic.On)
    .on(CharacteristicEventTypes.GET, async (callback: NodeCallback<CharacteristicValue>) => {
      debugGet(On, service);
      try {
        const data = (await getTydomDeviceData(client, {deviceId, endpointId})) as TydomEndpointData;
        const level = getTydomDataPropValue<number>(data, 'level');
        const nextValue = level > 0;
        debugGetResult(On, service, nextValue);
        callback(null, nextValue);
      } catch (err) {
        callback(err);
      }
    })
    .on(CharacteristicEventTypes.SET, async (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
      debugSet(On, service, value);
      try {
        const nextLevel = value ? state.latestBrightness || 100 : 0;
        await debouncedSetLevel(nextLevel);
        debugSetResult(On, service, value);
        callback();
      } catch (err) {
        callback(err);
      }
    })
    .getValue();

  service
    .getCharacteristic(Characteristic.Brightness)
    .on(CharacteristicEventTypes.GET, async (callback: NodeCallback<CharacteristicValue>) => {
      debugGet(Brightness, service);
      try {
        const data = await getTydomDeviceData<TydomEndpointData>(client, {deviceId, endpointId});
        const level = getTydomDataPropValue<number>(data, 'level');
        debugGetResult(Brightness, service, level);
        callback(null, level);
      } catch (err) {
        callback(err);
      }
    })
    .on(CharacteristicEventTypes.SET, async (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
      debugSet(Brightness, service, value);
      try {
        const nextValue = value as number;
        state.latestBrightness = nextValue;
        await debouncedSetLevel(nextValue);
        debugSetResult(Brightness, service, value);
        callback();
      } catch (err) {
        callback(err);
      }
    })
    .getValue();
};

export const updateLightbulb = (
  accessory: PlatformAccessory,
  controller: TydomController,
  updates: Record<string, unknown>[]
): void => {
  const {context} = accessory;
  const {metadata} = context;
  const {On, Brightness} = Characteristic;
  const levelMeta = find(metadata, {name: 'level'});
  // Not dimmable
  if (levelMeta?.step === 100) {
    updateAccessorySwitchableService(accessory, controller, updates, Service.Lightbulb);
    return;
  }
  // Dimmable
  updates.forEach((update) => {
    const {name, value} = update;
    switch (name) {
      case 'level': {
        const service = getAccessoryService(accessory, Service.Lightbulb);
        const level = value as number;
        if (level === null) {
          debug(`Encountered a ${chalkString('setpoint')} update with a null value!`);
          return;
        }
        debugSetUpdate(On, service, level > 0);
        service.updateCharacteristic(On, level > 0);
        // @NOTE Only update brightness for non-null values
        if (level > 0) {
          // @TODO ignore updates for legacy previous values
          debugSetUpdate(Brightness, service, level);
          service.updateCharacteristic(Brightness, level);
        }
        return;
      }
      default:
        return;
    }
  });
};
