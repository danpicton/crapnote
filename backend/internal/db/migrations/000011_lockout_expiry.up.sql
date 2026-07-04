-- Automatic (failed-login) lockouts now expire: locked_until holds the moment
-- the lock lapses. Manual admin locks leave it NULL, meaning indefinite.
ALTER TABLE users ADD COLUMN locked_until DATETIME;
