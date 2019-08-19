/**
 * @module LevelHelper
 * Providing methods dealing with playlist sliding and drift
 * */

import { logger } from '../utils/logger';
import Fragment from '../loader/fragment';
import LevelDetails from '../loader/level-details';
import { Level } from '../types/level';
import { LoaderStats } from '../types/loader';

export function addGroupId (level: Level, type: string, id: string): void {
  switch (type) {
  case 'audio':
    if (!level.audioGroupIds) {
      level.audioGroupIds = [];
    }
    level.audioGroupIds.push(id);
    break;
  case 'text':
    if (!level.textGroupIds) {
      level.textGroupIds = [];
    }
    level.textGroupIds.push(id);
    break;
  }
}

export function updatePTS (fragments: Fragment[], fromIdx: number, toIdx: number): void {
  let fragFrom = fragments[fromIdx], fragTo = fragments[toIdx], fragToPTS = fragTo.startPTS;
  // if we know startPTS[toIdx]
  if (Number.isFinite(fragToPTS)) {
    // update fragment duration.
    // it helps to fix drifts between playlist reported duration and fragment real duration
    if (toIdx > fromIdx) {
      fragFrom.duration = fragToPTS - fragFrom.start;
      if (fragFrom.duration < 0) {
        logger.warn(`negative duration computed for frag ${fragFrom.sn},level ${fragFrom.level}, there should be some duration drift between playlist and fragment!`);
      }
    } else {
      fragTo.duration = fragFrom.start - fragToPTS;
      if (fragTo.duration < 0) {
        logger.warn(`negative duration computed for frag ${fragTo.sn},level ${fragTo.level}, there should be some duration drift between playlist and fragment!`);
      }
    }
  } else {
    // we dont know startPTS[toIdx]
    if (toIdx > fromIdx) {
      fragTo.start = fragFrom.start + fragFrom.duration;
    } else {
      fragTo.start = Math.max(fragFrom.start - fragTo.duration, 0);
    }
  }
}

export function updateFragPTSDTS (details: LevelDetails, frag: Fragment, startPTS: number, endPTS: number, startDTS: number, endDTS: number): number {
  // update frag PTS/DTS
  let maxStartPTS = startPTS;
  if (Number.isFinite(frag.startPTS)) {
    // delta PTS between audio and video
    let deltaPTS = Math.abs(frag.startPTS - startPTS);
    if (!Number.isFinite(<number>frag.deltaPTS)) {
      frag.deltaPTS = deltaPTS;
    } else {
      frag.deltaPTS = Math.max(deltaPTS, <number>frag.deltaPTS);
    }

    maxStartPTS = Math.max(startPTS, frag.startPTS);
    startPTS = Math.min(startPTS, frag.startPTS);
    endPTS = Math.max(endPTS, frag.endPTS);
    startDTS = Math.min(startDTS, frag.startDTS);
    endDTS = Math.max(endDTS, frag.endDTS);
  }

  const drift = startPTS - frag.start;
  frag.start = frag.startPTS = startPTS;
  frag.maxStartPTS = maxStartPTS;
  frag.endPTS = endPTS;
  frag.startDTS = startDTS;
  frag.endDTS = endDTS;
  frag.duration = endPTS - startPTS;
  console.assert(frag.duration > 0, 'Fragment should have a positive duration', frag);

  const sn = <number>frag.sn; // 'initSegment'
  // exit if sn out of range
  if (!details || sn < details.startSN || sn > details.endSN) {
    return 0;
  }

  let fragIdx, fragments, i;
  fragIdx = sn - details.startSN;
  fragments = details.fragments;
  // update frag reference in fragments array
  // rationale is that fragments array might not contain this frag object.
  // this will happen if playlist has been refreshed between frag loading and call to updateFragPTSDTS()
  // if we don't update frag, we won't be able to propagate PTS info on the playlist
  // resulting in invalid sliding computation
  fragments[fragIdx] = frag;
  // adjust fragment PTS/duration from seqnum-1 to frag 0
  for (i = fragIdx; i > 0; i--) {
    updatePTS(fragments, i, i - 1);
  }

  // adjust fragment PTS/duration from seqnum to last frag
  for (i = fragIdx; i < fragments.length - 1; i++) {
    updatePTS(fragments, i, i + 1);
  }

  details.PTSKnown = true;
  return drift;
}

export function mergeDetails (oldDetails: LevelDetails, newDetails: LevelDetails): void {
  // potentially retrieve cached initsegment
  if (newDetails.initSegment && oldDetails.initSegment) {
    newDetails.initSegment = oldDetails.initSegment;
  }

  // check if old/new playlists have fragments in common
  // loop through overlapping SN and update startPTS , cc, and duration if any found
  let ccOffset = 0;
  let PTSFrag;
  mapFragmentIntersection(oldDetails, newDetails, (oldFrag, newFrag) => {
    ccOffset = oldFrag.cc - newFrag.cc;
    if (Number.isFinite(oldFrag.startPTS)) {
      newFrag.start = newFrag.startPTS = oldFrag.startPTS;
      newFrag.endPTS = oldFrag.endPTS;
      newFrag.startDTS = oldFrag.startDTS;
      newFrag.endDTS = oldFrag.endDTS;
      newFrag.duration = oldFrag.duration;
      newFrag.backtracked = oldFrag.backtracked;
      newFrag.dropped = oldFrag.dropped;
      PTSFrag = newFrag;
    }
    // PTS is known when there are overlapping segments
    newDetails.PTSKnown = true;
  });

  if (!newDetails.PTSKnown) {
    return;
  }

  if (ccOffset) {
    logger.log('discontinuity sliding from playlist, take drift into account');
    const newFragments = newDetails.fragments;
    for (let i = 0; i < newFragments.length; i++) {
      newFragments[i].cc += ccOffset;
    }
  }

  // if at least one fragment contains PTS info, recompute PTS information for all fragments
  if (PTSFrag) {
    updateFragPTSDTS(newDetails, PTSFrag, PTSFrag.startPTS, PTSFrag.endPTS, PTSFrag.startDTS, PTSFrag.endDTS);
  } else {
    // ensure that delta is within oldFragments range
    // also adjust sliding in case delta is 0 (we could have old=[50-60] and new=old=[50-61])
    // in that case we also need to adjust start offset of all fragments
    adjustSliding(oldDetails, newDetails);
  }
  // if we are here, it means we have fragments overlapping between
  // old and new level. reliable PTS info is thus relying on old level
  newDetails.PTSKnown = oldDetails.PTSKnown;
}

export function mergeSubtitlePlaylists (oldPlaylist: LevelDetails, newPlaylist: LevelDetails, referenceStart = 0): void {
  let lastIndex = -1;
  mapFragmentIntersection(oldPlaylist, newPlaylist, (oldFrag, newFrag, index) => {
    newFrag.start = oldFrag.start;
    lastIndex = index;
  });

  const frags = newPlaylist.fragments;
  if (lastIndex < 0) {
    frags.forEach(frag => {
      frag.start += referenceStart;
    });
    return;
  }

  for (let i = lastIndex + 1; i < frags.length; i++) {
    frags[i].start = (frags[i - 1].start + frags[i - 1].duration);
  }
}

export function mapFragmentIntersection (oldPlaylist: LevelDetails, newPlaylist: LevelDetails, intersectionFn): void {
  if (!oldPlaylist || !newPlaylist) {
    return;
  }

  const start = Math.max(oldPlaylist.startSN, newPlaylist.startSN) - newPlaylist.startSN;
  const end = Math.min(oldPlaylist.endSN, newPlaylist.endSN) - newPlaylist.startSN;
  const delta = newPlaylist.startSN - oldPlaylist.startSN;

  for (let i = start; i <= end; i++) {
    const oldFrag = oldPlaylist.fragments[delta + i];
    const newFrag = newPlaylist.fragments[i];
    if (!oldFrag || !newFrag) {
      break;
    }
    intersectionFn(oldFrag, newFrag, i);
  }
}

export function adjustSliding (oldPlaylist: LevelDetails, newPlaylist: LevelDetails): void {
  const delta = newPlaylist.startSN - oldPlaylist.startSN;
  const oldFragments = oldPlaylist.fragments;
  const newFragments = newPlaylist.fragments;

  if (delta < 0 || delta > oldFragments.length) {
    return;
  }
  for (let i = 0; i < newFragments.length; i++) {
    newFragments[i].start += oldFragments[delta].start;
  }
}

export function computeReloadInterval (newDetails: LevelDetails, stats: LoaderStats): number {
  const reloadInterval = 1000 * (newDetails.averagetargetduration ? newDetails.averagetargetduration : newDetails.targetduration);
  const reloadIntervalAfterMiss = reloadInterval / 2;
  const timeSinceLastModified = newDetails.lastModified ? +new Date() - newDetails.lastModified : 0;
  const useLastModified = timeSinceLastModified > 0 && timeSinceLastModified < reloadInterval * 3;
  const roundTrip = stats ? stats.loading.end - stats.loading.start : 0;

  let estimatedTimeUntilUpdate = reloadInterval;
  let availabilityDelay = newDetails.availabilityDelay;
  // let estimate = 'average';

  if (newDetails.updated === false) {
    if (useLastModified) {
      // estimate = 'miss round trip';
      // We should have had a hit so try again in the time it takes to get a response,
      // but no less than ~1/4 second. After 4 retries, at least 1.1 seconds will have gone by.
      const minRetry = 283;
      estimatedTimeUntilUpdate = Math.max(Math.min(reloadIntervalAfterMiss, roundTrip), minRetry);
    } else {
      // estimate = 'miss half average';
      // follow HLS Spec, If the client reloads a Playlist file and finds that it has not
      // changed then it MUST wait for a period of one-half the target
      // duration before retrying.
      estimatedTimeUntilUpdate = reloadIntervalAfterMiss;
    }
  } else if (useLastModified) {
    // estimate = 'next modified date';
    // Get the closest we've been to timeSinceLastModified on update
    availabilityDelay = Math.min(availabilityDelay || reloadInterval / 2, timeSinceLastModified);
    // TODO: Network controllers should maintain this and other stats, rather than passing it from one level details to then next after each response
    newDetails.availabilityDelay = availabilityDelay;
    // TODO: Back off from reloading too close to the time the server is expected to update,  rather than using this hardcoded value
    const minAvailabilityDelay = 1000;
    estimatedTimeUntilUpdate = Math.max(availabilityDelay / 2, minAvailabilityDelay) + reloadInterval - timeSinceLastModified;
  } else {
    estimatedTimeUntilUpdate = reloadInterval - roundTrip;
  }

  // console.log(`[computeReloadInterval] live reload ${newDetails.updated ? 'REFRESHED' : 'MISSED'}`,
  //   '\n  method', estimate,
  //   '\n  estimated time until update =>', estimatedTimeUntilUpdate,
  //   '\n  average target duration', reloadInterval,
  //   '\n  time since modified', timeSinceLastModified,
  //   '\n  time round trip', roundTrip,
  //   '\n  availability delay', availabilityDelay);

  return Math.round(estimatedTimeUntilUpdate);
}

export function getProgramDateTimeAtEndOfLastEncodedFragment (levelDetails: LevelDetails): number | null {
  if (levelDetails.hasProgramDateTime) {
    const encodedFragments = levelDetails.fragments.filter((fragment) => !fragment.prefetch);
    const lastEncodedFrag = encodedFragments[encodedFragments.length - 1];
    if (Number.isFinite(<number>lastEncodedFrag.programDateTime)) {
      return <number>lastEncodedFrag.programDateTime + lastEncodedFrag.duration * 1000;
    }
  }
  return null;
}

export function getFragmentWithSN (level: Level, sn: number): Fragment | null {
  if (!level || !level.details) {
    return null;
  }
  const levelDetails = level.details;
  return levelDetails.fragments[sn - levelDetails.startSN];
}
