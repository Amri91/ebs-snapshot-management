if (!process.env.TAG_NAME || !process.env.TAG_VALUE || !process.env.RETENTION_PERIOD) {
    console.error ('TAG_NAME, TAG_VALUE, and RETENTION_PERIOD must be set.')
    process.exit (1)
}
const isProduction = process.env.NODE_ENV === 'production'

// Sanctuary setup
const { create, env: sanctuaryEnv } = require ('sanctuary')
const F = require ('fluture')
const { env: flutureEnv} = require('fluture-sanctuary-types')
const env = sanctuaryEnv.concat (flutureEnv)
const checkTypes = !isProduction
const S = create({ checkTypes, env })

// AWS setup
const AWS = require ('aws-sdk')
AWS.config.apiVersions = {
    ec2: '2016-11-15',
    sts: '2011-06-15'
}
const endpoint = process.env.ENDPOINT ? new AWS.Endpoint (process.env.ENDPOINT) : null
const [EC2, STS] = process.env.ENDPOINT ?
  [new AWS.EC2 ({ endpoint }), new AWS.STS ({ endpoint })] :
  [new AWS.EC2 (), new AWS.STS ()]

const log = title => any => isProduction ? console.log (`${title}: ${S.show (any)}`) || any : any

const DryRun = Boolean(process.env.DRY_RUN)

const TRACKING_TAG = { Key: process.env.TAG_NAME, Value: process.env.TAG_VALUE }

const splitEvery = n => xs => y => xs.length === 0 ? y : splitEvery (n) (xs.slice (n)) (y.concat([xs.slice(0, n)]))

const tag1kResources = tag => partialResources =>
  F.node (cb => EC2.createTags ({Resources: partialResources, Tags: [tag], DryRun}, cb))

const tagEc2Resource = tag => resources => {
    const chunkedTagTasks = S.map (tag1kResources (tag)) (splitEvery (1000) (resources) ([]))
    return F.parallel (1) (chunkedTagTasks)
}

const tagEqual = tagA => tagB => tagA.Key === tagB.Key && tagA.Value === tagB.Value
const tracked = resource => resource['Tags'].some (tagEqual (TRACKING_TAG))

const amazonSnapshot = snapshot => snapshot['Description'].startsWith ('Auto-created snapshot')
const getCallerIdentity = F.node (cb => STS.getCallerIdentity ({}, cb))
const listSnapshots = Filters => ownerId => F.node (cb => EC2.describeSnapshots ({Filters, OwnerIds: [ownerId], DryRun}, cb))
const listOwnSnapshots = filters =>
  getCallerIdentity
    .pipe (S.map (S.prop ('Account')))
    .pipe (S.chain (listSnapshots (filters)))
    .pipe (S.map (S.prop ('Snapshots')))
    .pipe (S.map (S.reject (amazonSnapshot)))

const listVolumes =  F.node (cb => EC2.describeVolumes ({}, cb))
const tagUntrackedVolumes =
  listVolumes
    .pipe (S.map (S.prop ('Volumes')))
    .pipe (S.map (S.reject (tracked)))
    .pipe (S.map (S.map (S.prop ('VolumeId'))))
    .pipe (S.map (log ('Volumes to tag')))
    .pipe (S.chain (tagEc2Resource (TRACKING_TAG)))

const DELETE_TAG = 'DELETE_ON'
const hasDeleteTag = S.pipe ([S.prop ('Tags'), S.map (S.prop ('Key')), S.elem (DELETE_TAG)])
const getDeleteMarker = today => {
    const dateInTheFuture = new Date ()
    dateInTheFuture.setTime (today.getTime () + (24 * 60 * 60 * 1000) * Number (process.env.RETENTION_PERIOD))
    return {
        Key: DELETE_TAG, Value: dateInTheFuture.toISOString ()
    }
}

const markNonStandardSnapshots = today =>
  listOwnSnapshots (null)
    .pipe (S.map (S.reject (tracked)))
    .pipe (S.map (S.reject (hasDeleteTag)))
    .pipe (S.map (S.map (S.prop ('SnapshotId'))))
    .pipe (S.map (log ('Snapshots to mark')))
    .pipe (S.chain (tagEc2Resource (getDeleteMarker (today))))

const expired = today => snapshot => new Date (snapshot['Tags'].filter (s => s.Key === DELETE_TAG)[0].Value) < today
const deleteSnapshot = SnapshotId => F.node (cb => EC2.deleteSnapshot ({SnapshotId, DryRun}, cb))
const deleteExpiredSnapshots = today =>
  listOwnSnapshots ([{Name: 'tag-key', Values: [DELETE_TAG]}])
    .pipe (S.map (S.filter (hasDeleteTag)))
    .pipe (S.map (S.filter (expired (today))))
    .pipe (S.map (S.map (S.prop ('SnapshotId'))))
    .pipe (S.map (log ('Snapshots to delete')))
    .pipe (S.map (S.map (deleteSnapshot)))
    .pipe (S.map (S.sequence (F)))
    .pipe (S.join)

const run = futures => cb =>
  F.fork (cb)
         (result => cb (null, result))
         (F.parallel (3) (futures))

const handler = (event, __, cb) => {
    console.log (event)
    const date = new Date (event.time)
    run ([tagUntrackedVolumes, markNonStandardSnapshots (date), deleteExpiredSnapshots (date)]) (cb)
}

module.exports = {
    run, handler, listOwnSnapshots, EC2, markNonStandardSnapshots, deleteExpiredSnapshots, tracked,
    TRACKING_TAG, S, F, tagUntrackedVolumes
}
