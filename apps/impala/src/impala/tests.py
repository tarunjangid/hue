#!/usr/bin/env python
# Licensed to Cloudera, Inc. under one
# or more contributor license agreements.  See the NOTICE file
# distributed with this work for additional information
# regarding copyright ownership.  Cloudera, Inc. licenses this file
# to you under the Apache License, Version 2.0 (the
# "License"); you may not use this file except in compliance
# with the License.  You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

import re
import sys
import json
import logging
from builtins import object
from unittest.mock import Mock, patch

import pytest
from django.urls import reverse

import desktop.conf as desktop_conf
from beeswax import data_export
from beeswax.data_export import download
from beeswax.design import hql_query
from beeswax.models import QueryHistory, SavedQuery
from beeswax.server import dbms
from beeswax.test_base import fetch_query_result_data, get_query_server_config, wait_for_query_to_finish
from beeswax.tests import _make_query
from desktop.lib.django_test_util import make_logged_in_client
from desktop.lib.exceptions_renderable import PopupException
from desktop.lib.test_utils import add_to_group
from desktop.models import Document
from hadoop.pseudo_hdfs4 import get_db_prefix, is_live_cluster
from impala import conf
from impala.dbms import ImpalaDbms
from useradmin.models import User

LOG = logging.getLogger()


class MockDbms(object):
  def get_databases(self):
    return ['db1', 'db2']

  def get_tables(self, database):
    return ['table1', 'table2']


@pytest.mark.django_db
class TestMockedImpala(object):
  def setup_method(self):
    self.client = make_logged_in_client()

    # Mock DB calls as we don't need the real ones
    self.prev_dbms = dbms.get
    dbms.get = lambda a, b: MockDbms()

  def teardown_method(self):
    # Remove monkey patching
    dbms.get = self.prev_dbms

  def test_basic_flow(self):
    response = self.client.get("/impala/")
    assert re.search(b'Impala', response.content), response.content
    assert b'Query Editor' in response.content

    response = self.client.get("/impala/execute/")
    assert b'Query Editor' in response.content

  def test_saved_queries(self):
    user = User.objects.get(username='test')

    response = self.client.get("/impala/list_designs")
    assert len(response.context[0]['page'].object_list) == 0

    try:
      beewax_query = create_saved_query('beeswax', user)
      response = self.client.get("/impala/list_designs")
      assert len(response.context[0]['page'].object_list) == 0

      impala_query = create_saved_query('impala', user)
      response = self.client.get("/impala/list_designs")
      assert len(response.context[0]['page'].object_list) == 1

      # Test my query page
      QueryHistory.objects.create(owner=user, design=impala_query, query='', last_state=QueryHistory.STATE.available.value)

      resp = self.client.get('/impala/my_queries')
      assert len(resp.context[0]['q_page'].object_list) == 1
      assert resp.context[0]['h_page'].object_list[0].design.name == 'create_saved_query'
    finally:
      if beewax_query is not None:
        beewax_query.delete()
      if impala_query is not None:
        impala_query.delete()

  def test_invalidate(self):
    with patch('impala.dbms.ImpalaDbms._get_different_tables') as get_different_tables:
      with patch('desktop.models.ClusterConfig.get_hive_metastore_interpreters') as get_hive_metastore_interpreters:
        ddms = ImpalaDbms(Mock(query_server={'server_name': ''}), None)
        get_different_tables.return_value = ['customers']

        get_hive_metastore_interpreters.return_value = []
        with pytest.raises(PopupException):
          ddms.invalidate('default')  # No hive/metastore configured

        get_hive_metastore_interpreters.return_value = ['hive']
        ddms.invalidate('default')
        ddms.client.query.assert_called_once_with(ddms.client.query.call_args[0][0])
        assert 'customers' in ddms.client.query.call_args[0][0].hql_query  # diff of 1 table

        get_different_tables.return_value = ['customers', '', '', '', '', '', '', '', '', '', '']
        with pytest.raises(PopupException):
          ddms.invalidate('default')  # diff of 11 tables. Limit is 10.

        ddms.invalidate('default', 'customers')
        assert ddms.client.query.call_count == 2  # Second call
        assert 'customers' in ddms.client.query.call_args[0][0].hql_query  # invalidate 1 table

        ddms.invalidate()
        assert ddms.client.query.call_count == 3  # Third call
        assert 'customers' not in ddms.client.query.call_args[0][0].hql_query  # Full invalidate


@pytest.mark.integration
class TestImpalaIntegration(object):
  @classmethod
  def setup_class(cls):
    cls.finish = []

    if not is_live_cluster():
      pytest.skip("Skipping Test")

    cls.client = make_logged_in_client()
    cls.user = User.objects.get(username='test')
    add_to_group('test')
    cls.db = dbms.get(cls.user, get_query_server_config(name='impala'))
    cls.DATABASE = get_db_prefix(name='impala')

    queries = [
      'DROP TABLE IF EXISTS %(db)s.tweets;' % {'db': cls.DATABASE},
      'DROP DATABASE IF EXISTS %(db)s CASCADE;' % {'db': cls.DATABASE},
      'CREATE DATABASE %(db)s;' % {'db': cls.DATABASE},
    ]

    for query in queries:
      resp = _make_query(cls.client, query, database='default', local=False, server_name='impala')
      resp = wait_for_query_to_finish(cls.client, resp, max=180.0)
      content = json.loads(resp.content)
      assert content['status'] == 0, resp.content

    queries = [
      """
      CREATE TABLE tweets (row_num INTEGER, id_str STRING, text STRING) STORED AS PARQUET;
    """,
      """
      INSERT INTO TABLE tweets VALUES (1, "531091827395682000", "My dad looks younger than costa");
    """,
      """
      INSERT INTO TABLE tweets VALUES (2, "531091827781550000", "There is a thin line between your partner being vengeful and you reaping the consequences of your bad actions towards your partner.");
    """,  # noqa: E501
      """
      INSERT INTO TABLE tweets VALUES (3, "531091827768979000", "@Mustang_Sally83 and they need to get into you :))))");
    """,
      """
      INSERT INTO TABLE tweets VALUES (4, "531091827114668000", "@RachelZJohnson thank you rach!xxx");
    """,
      """
      INSERT INTO TABLE tweets VALUES (5, "531091827949309000", "i think @WWERollins was robbed of the IC title match this week on RAW also i wonder if he will get a rematch i hope so @WWE");
    """,  # noqa: E501
    ]

    for query in queries:
      resp = _make_query(cls.client, query, database=cls.DATABASE, local=False, server_name='impala')
      resp = wait_for_query_to_finish(cls.client, resp, max=180.0)
      content = json.loads(resp.content)
      assert content['status'] == 0, resp.content

  @classmethod
  def teardown_class(cls):
    # We need to drop tables before dropping the database
    queries = [
      """
      DROP TABLE IF EXISTS %(db)s.tweets;
    """
      % {'db': cls.DATABASE},
      """
      DROP DATABASE %(db)s CASCADE;
    """
      % {'db': cls.DATABASE},
    ]
    for query in queries:
      resp = _make_query(cls.client, query, database='default', local=False, server_name='impala')
      resp = wait_for_query_to_finish(cls.client, resp, max=180.0)

    # Check the cleanup
    databases = cls.db.get_databases()
    assert cls.DATABASE not in databases
    assert '%(db)s_other' % {'db': cls.DATABASE} not in databases

    for f in cls.finish:
      f()

  def test_basic_flow(self):
    dbs = self.db.get_databases()
    assert '_impala_builtins' in dbs, dbs
    assert self.DATABASE in dbs, dbs

    tables = self.db.get_tables(database=self.DATABASE)
    assert 'tweets' in tables, tables

    QUERY = """
      SELECT * FROM tweets ORDER BY row_num;
    """
    response = _make_query(self.client, QUERY, database=self.DATABASE, local=False, server_name='impala')
    content = json.loads(response.content)
    query_history = QueryHistory.get(content['id'])

    response = wait_for_query_to_finish(self.client, response, max=180.0)

    results = []

    # Check that we multiple fetches get all the result set
    while len(results) < 5:
      # We get less than 5 results most of the time, so increase offset
      content = fetch_query_result_data(self.client, response, n=len(results), server_name='impala')
      results += content['results']

    assert [1, 2, 3, 4, 5] == [col[0] for col in results]

    # Check start over
    results_start_over = []

    while len(results_start_over) < 5:
      content = fetch_query_result_data(self.client, response, n=len(results_start_over), server_name='impala')
      results_start_over += content['results']

    assert results_start_over == results

    # Check cancel query
    resp = self.client.post(reverse('impala:api_cancel_query', kwargs={'query_history_id': query_history.id}))
    content = json.loads(resp.content)
    assert 0 == content['status']

  def test_data_download(self):
    hql = 'SELECT * FROM tweets %(limit)s'

    FETCH_SIZE = data_export.FETCH_SIZE
    data_export.FETCH_SIZE = 2  # Decrease fetch size to validate last fetch logic

    try:
      query = hql_query(hql % {'limit': ''})

      handle = self.db.execute_and_wait(query)
      # Get the result in csv. Should have 5 + 1 header row.
      csv_resp = download(handle, 'csv', self.db)
      csv_content = ''.join(csv_resp.streaming_content)
      assert len(csv_content.strip().split('\n')) == 5 + 1

      query = hql_query(hql % {'limit': 'LIMIT 0'})

      handle = self.db.execute_and_wait(query)
      csv_resp = download(handle, 'csv', self.db)
      csv_content = ''.join(csv_resp.streaming_content)
      assert len(csv_content.strip().split('\n')) == 1

      query = hql_query(hql % {'limit': 'LIMIT 1'})

      handle = self.db.execute_and_wait(query)
      csv_resp = download(handle, 'csv', self.db)
      csv_content = ''.join(csv_resp.streaming_content)
      assert len(csv_content.strip().split('\n')) == 1 + 1

      query = hql_query(hql % {'limit': 'LIMIT 2'})

      handle = self.db.execute_and_wait(query)
      csv_resp = download(handle, 'csv', self.db)
      csv_content = ''.join(csv_resp.streaming_content)
      assert len(csv_content.strip().split('\n')) == 1 + 2
    finally:
      data_export.FETCH_SIZE = FETCH_SIZE

  def test_explain(self):
    QUERY = """
      SELECT * FROM tweets ORDER BY row_num;
    """
    response = _make_query(self.client, QUERY, database=self.DATABASE, local=False, server_name='impala', submission_type='Explain')
    json_response = json.loads(response.content)
    assert 'MERGING-EXCHANGE' in json_response['explanation'], json_response
    assert 'SCAN HDFS' in json_response['explanation'], json_response

  def test_get_table_sample(self):
    client = make_logged_in_client()

    resp = client.get(reverse('impala:get_sample_data', kwargs={'database': self.DATABASE, 'table': 'tweets'}))
    data = json.loads(resp.content)
    assert 0 == data['status'], data
    assert ['row_num', 'id_str', 'text'] == data['headers'], data
    assert len(data['rows']), data

  def test_get_session(self):
    session = None
    try:
      # Create open session
      session = self.db.open_session(self.user)

      resp = self.client.get(reverse("impala:api_get_session"))
      data = json.loads(resp.content)
      assert 'properties' in data
      assert data['properties'].get('http_addr')
      assert 'session' in data, data
      assert 'id' in data['session'], data['session']
    finally:
      if session is not None:
        try:
          self.db.close_session(session)
        except Exception:
          pass

  def test_get_settings(self):
    resp = self.client.get(reverse("impala:get_settings"))
    json_resp = json.loads(resp.content)
    assert 0 == json_resp['status']
    assert 'QUERY_TIMEOUT_S' in json_resp['settings']

  def test_invalidate_tables(self):
    # Helper function to get Impala and Beeswax (HMS) tables
    def get_impala_beeswax_tables():
      impala_resp = self.client.get(reverse('impala:api_autocomplete_tables', kwargs={'database': self.DATABASE}))
      impala_tables_meta = json.loads(impala_resp.content)['tables_meta']
      impala_tables = [table['name'] for table in impala_tables_meta]
      beeswax_resp = self.client.get(reverse('beeswax:api_autocomplete_tables', kwargs={'database': self.DATABASE}))
      beeswax_tables_meta = json.loads(beeswax_resp.content)['tables_meta']
      beeswax_tables = [table['name'] for table in beeswax_tables_meta]
      return impala_tables, beeswax_tables

    impala_tables, beeswax_tables = get_impala_beeswax_tables()
    assert impala_tables == beeswax_tables, "\ntest_invalidate_tables: `%s`\nImpala Tables: %s\nBeeswax Tables: %s" % (
      self.DATABASE,
      ','.join(impala_tables),
      ','.join(beeswax_tables),
    )

    hql = """
      CREATE TABLE new_table (a INT);
    """
    resp = _make_query(self.client, hql, wait=True, local=False, max=180.0, database=self.DATABASE)

    impala_tables, beeswax_tables = get_impala_beeswax_tables()
    # New table is not found by Impala
    assert 'new_table' in beeswax_tables, beeswax_tables
    assert 'new_table' not in impala_tables, impala_tables

    resp = self.client.post(reverse('impala:invalidate'), {'database': self.DATABASE})

    impala_tables, beeswax_tables = get_impala_beeswax_tables()
    # Invalidate picks up new table
    assert impala_tables == beeswax_tables, "\ntest_invalidate_tables: `%s`\nImpala Tables: %s\nBeeswax Tables: %s" % (
      self.DATABASE,
      ','.join(impala_tables),
      ','.join(beeswax_tables),
    )

  def test_refresh_table(self):
    # Helper function to get Impala and Beeswax (HMS) columns
    def get_impala_beeswax_columns():
      impala_resp = self.client.get(reverse('impala:api_autocomplete_columns', kwargs={'database': self.DATABASE, 'table': 'tweets'}))
      impala_columns = json.loads(impala_resp.content)['columns']
      beeswax_resp = self.client.get(reverse('beeswax:api_autocomplete_columns', kwargs={'database': self.DATABASE, 'table': 'tweets'}))
      beeswax_columns = json.loads(beeswax_resp.content)['columns']
      return impala_columns, beeswax_columns

    impala_columns, beeswax_columns = get_impala_beeswax_columns()
    assert impala_columns == beeswax_columns, "\ntest_refresh_table: `%s`.`%s`\nImpala Columns: %s\nBeeswax Columns: %s" % (
      self.DATABASE,
      'tweets',
      ','.join(impala_columns),
      ','.join(beeswax_columns),
    )

    hql = """
      ALTER TABLE tweets ADD COLUMNS (new_column INT);
    """
    resp = _make_query(self.client, hql, wait=True, local=False, max=180.0, database=self.DATABASE)

    impala_columns, beeswax_columns = get_impala_beeswax_columns()
    # New column is not found by Impala
    assert 'new_column' in beeswax_columns, beeswax_columns
    assert 'new_column' not in impala_columns, impala_columns

    resp = self.client.post(reverse('impala:refresh_table', kwargs={'database': self.DATABASE, 'table': 'tweets'}))

    impala_columns, beeswax_columns = get_impala_beeswax_columns()
    # Invalidate picks up new column
    assert impala_columns == beeswax_columns, "\ntest_refresh_table: `%s`.`%s`\nImpala Columns: %s\nBeeswax Columns: %s" % (
      self.DATABASE,
      'tweets',
      ','.join(impala_columns),
      ','.join(beeswax_columns),
    )

  def test_get_exec_summary(self):
    query = """
      SELECT COUNT(1) FROM tweets;
    """

    response = _make_query(self.client, query, database=self.DATABASE, local=False, server_name='impala')
    content = json.loads(response.content)
    query_history = QueryHistory.get(content['id'])

    wait_for_query_to_finish(self.client, response, max=180.0)

    resp = self.client.post(reverse('impala:get_exec_summary', kwargs={'query_history_id': query_history.id}))
    data = json.loads(resp.content)
    assert 0 == data['status'], data
    assert 'nodes' in data['summary'], data
    assert len(data['summary']['nodes']) > 0, data['summary']['nodes']

    # Attempt to call get_exec_summary on a closed query
    resp = self.client.post(reverse('impala:get_exec_summary', kwargs={'query_history_id': query_history.id}))
    data = json.loads(resp.content)
    assert 0 == data['status'], data
    assert 'nodes' in data['summary'], data
    assert len(data['summary']['nodes']) > 0, data['summary']['nodes']

  def test_get_runtime_profile(self):
    query = """
      SELECT COUNT(1) FROM tweets;
    """

    response = _make_query(self.client, query, database=self.DATABASE, local=False, server_name='impala')
    content = json.loads(response.content)
    query_history = QueryHistory.get(content['id'])

    wait_for_query_to_finish(self.client, response, max=180.0)

    resp = self.client.post(reverse('impala:get_runtime_profile', kwargs={'query_history_id': query_history.id}))
    data = json.loads(resp.content)
    assert 0 == data['status'], data
    assert 'Execution Profile' in data['profile'], data


# Could be refactored with SavedQuery.create_empty()
def create_saved_query(app_name, owner):
  query_type = SavedQuery.TYPES_MAPPING[app_name]
  design = SavedQuery(owner=owner, type=query_type)
  design.name = 'create_saved_query'
  design.desc = ''
  design.data = hql_query('show $tables', database='db1').dumps()
  design.is_auto = False
  design.save()

  Document.objects.link(design, owner=design.owner, extra=design.type, name=design.name, description=design.desc)

  return design


def test_ssl_cacerts():
  for desktop_kwargs, conf_kwargs, expected in [
    ({'present': False}, {'present': False}, ''),
    ({'present': False}, {'data': 'local-cacerts.pem'}, 'local-cacerts.pem'),
    ({'data': 'global-cacerts.pem'}, {'present': False}, 'global-cacerts.pem'),
    ({'data': 'global-cacerts.pem'}, {'data': 'local-cacerts.pem'}, 'local-cacerts.pem'),
  ]:
    resets = [
      desktop_conf.SSL_CACERTS.set_for_testing(**desktop_kwargs),
      conf.SSL.CACERTS.set_for_testing(**conf_kwargs),
    ]

    try:
      assert conf.SSL.CACERTS.get() == expected, 'desktop:%s conf:%s expected:%s got:%s' % (
        desktop_kwargs,
        conf_kwargs,
        expected,
        conf.SSL.CACERTS.get(),
      )
    finally:
      for reset in resets:
        reset()


def test_ssl_validate():
  for desktop_kwargs, conf_kwargs, expected in [
    ({'present': False}, {'present': False}, True),
    ({'present': False}, {'data': False}, False),
    ({'present': False}, {'data': True}, True),
    ({'data': False}, {'present': False}, False),
    ({'data': False}, {'data': False}, False),
    ({'data': False}, {'data': True}, True),
    ({'data': True}, {'present': False}, True),
    ({'data': True}, {'data': False}, False),
    ({'data': True}, {'data': True}, True),
  ]:
    resets = [
      desktop_conf.SSL_VALIDATE.set_for_testing(**desktop_kwargs),
      conf.SSL.VALIDATE.set_for_testing(**conf_kwargs),
    ]

    try:
      assert conf.SSL.VALIDATE.get() == expected, 'desktop:%s conf:%s expected:%s got:%s' % (
        desktop_kwargs,
        conf_kwargs,
        expected,
        conf.SSL.VALIDATE.get(),
      )
    finally:
      for reset in resets:
        reset()


def test_thrift_over_http_config():
  resets = [
    conf.SERVER_HOST.set_for_testing('impalad_host'),
    conf.SERVER_PORT.set_for_testing(21050),
    conf.USE_THRIFT_HTTP.set_for_testing(True),
  ]
  with patch('impala.dbms.get_hs2_http_port') as get_hs2_http_port:
    get_hs2_http_port.return_value = 30000
    try:
      query_server = get_query_server_config(name='impala')
      assert query_server['server_port'] == 30000
      assert query_server['transport_mode'] == 'http'
      assert query_server['http_url'] == 'http://impalad_host:30000'
    finally:
      for reset in resets:
        reset()


def test_thrift_over_http_config_with_proxy_endpoint():
  resets = [
    conf.SERVER_HOST.set_for_testing('impala_proxy'),
    conf.SERVER_PORT.set_for_testing(36000),
    conf.USE_THRIFT_HTTP.set_for_testing(True),
    conf.PROXY_ENDPOINT.set_for_testing('/endpoint'),
  ]
  with patch('impala.dbms.get_hs2_http_port') as get_hs2_http_port:
    get_hs2_http_port.return_value = 30000
    try:
      query_server = get_query_server_config(name='impala')
      assert query_server['server_port'] == 36000
      assert query_server['transport_mode'] == 'http'
      assert query_server['http_url'] == 'http://impala_proxy:36000/endpoint'
    finally:
      for reset in resets:
        reset()


class TestImpalaDbms(object):
  def test_get_impala_nested_select(self):
    assert ImpalaDbms.get_nested_select('default', 'customers', 'id', None) == ('id', '`default`.`customers`')
    assert ImpalaDbms.get_nested_select('default', 'customers', 'email_preferences', 'categories/promos/') == (
      'email_preferences.categories.promos',
      '`default`.`customers`',
    )
    assert ImpalaDbms.get_nested_select('default', 'customers', 'addresses', 'key') == ('key', '`default`.`customers`.`addresses`')
    assert ImpalaDbms.get_nested_select('default', 'customers', 'addresses', 'value/street_1/') == (
      'street_1',
      '`default`.`customers`.`addresses`',
    )
    assert ImpalaDbms.get_nested_select('default', 'customers', 'orders', 'item/order_date') == (
      'order_date',
      '`default`.`customers`.`orders`',
    )
    assert ImpalaDbms.get_nested_select('default', 'customers', 'orders', 'item/items/item/product_id') == (
      'product_id',
      '`default`.`customers`.`orders`.`items`',
    )
